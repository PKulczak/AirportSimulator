import numpy as np
import pytest
import simpy
from django.utils import timezone
from datetime import timedelta

from api.models import Aircraft, Simulation, SimulationRunway, SimulationRunwayEvent
from api.simulation import constants
from api.simulation.closures import closure_process
from api.simulation.simulation_runner import SimulationRunner
from api.simulation.simulation_runway_wrapper import SimulationRunwayWrapper
from tests.base_test import BaseFeatureTest


def test_worse_weather_scales_up_the_base_operation_time():
    clear = SimulationRunner._operation_minutes(140, Simulation.WeatherCondition.CLEAR)
    windy = SimulationRunner._operation_minutes(140, Simulation.WeatherCondition.WINDY)
    snow = SimulationRunner._operation_minutes(140, Simulation.WeatherCondition.SNOW)
    low_visibility = SimulationRunner._operation_minutes(140, Simulation.WeatherCondition.LOW_VISIBILITY)

    assert clear < windy < snow < low_visibility


def test_operation_minutes_defaults_to_clear_weather_when_unspecified():
    assert SimulationRunner._operation_minutes(140) == SimulationRunner._operation_minutes(
        140, Simulation.WeatherCondition.CLEAR
    )


class _FakeWrapper:
    def __init__(self, last_operation_class, last_operation_end_time):
        self.last_operation_class = last_operation_class
        self.last_operation_end_time = last_operation_end_time


def test_worse_weather_scales_up_wake_separation_minima():
    wrapper = _FakeWrapper(last_operation_class="Heavy", last_operation_end_time=0.0)

    clear = SimulationRunner._wake_separation_extra_minutes(
        wrapper, "Light", now=0.0, weather_condition=Simulation.WeatherCondition.CLEAR
    )
    snow = SimulationRunner._wake_separation_extra_minutes(
        wrapper, "Light", now=0.0, weather_condition=Simulation.WeatherCondition.SNOW
    )

    assert clear == constants.WAKE_SEPARATION_EXTRA_MINUTES[("Heavy", "Light")]
    assert snow == pytest.approx(clear * constants.WEATHER_SEPARATION_MULTIPLIER["Snow"])
    assert snow > clear


def test_wake_separation_defaults_to_clear_weather_when_unspecified():
    wrapper = _FakeWrapper(last_operation_class="Heavy", last_operation_end_time=0.0)
    assert SimulationRunner._wake_separation_extra_minutes(
        wrapper, "Light", now=0.0
    ) == SimulationRunner._wake_separation_extra_minutes(
        wrapper, "Light", now=0.0, weather_condition=Simulation.WeatherCondition.CLEAR
    )


def _run_closure_process(weather_condition, seed, until):
    helper = BaseFeatureTest()
    simulation = helper.create_simulations()
    # Unique identifier per call — each call creates its own runway row in the
    # same test's DB, and the model enforces a unique identifier.
    runway = helper.create_runways(1, identifier=f"RW-{weather_condition}-{seed}")[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation, runway=runway, operating_mode=SimulationRunway.OperatingMode.MIXED
    )
    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)
    rng = np.random.default_rng(seed)
    base_time = timezone.now()

    def to_datetime(now):
        return base_time + timedelta(minutes=float(now))

    env.process(
        closure_process(env, rng, simulation_runway, wrapper, to_datetime, weather_condition)
    )
    env.run(until=until)

    return SimulationRunwayEvent.objects.filter(
        simulation_runway=simulation_runway,
        event_type=SimulationRunwayEvent.EventType.CLOSED,
    ).count()


@pytest.mark.django_db
def test_worse_weather_closes_the_runway_more_often_with_the_same_seed():
    # Same seed for both isolates the comparison to the weather-driven mean
    # interval scaling — with independent seeds the closure counts could
    # differ just from luck of the draw, not the effect under test.
    clear_closures = _run_closure_process(Simulation.WeatherCondition.CLEAR, seed=1, until=2000)
    snow_closures = _run_closure_process(Simulation.WeatherCondition.SNOW, seed=1, until=2000)

    assert snow_closures > clear_closures


@pytest.mark.django_db
def test_snow_weather_closures_are_almost_always_snow_clearance():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations()
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation, runway=runway, operating_mode=SimulationRunway.OperatingMode.MIXED
    )
    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)
    rng = np.random.default_rng(3)
    base_time = timezone.now()

    def to_datetime(now):
        return base_time + timedelta(minutes=float(now))

    env.process(
        closure_process(
            env, rng, simulation_runway, wrapper, to_datetime, Simulation.WeatherCondition.SNOW
        )
    )
    env.run(until=2000)

    closed_events = SimulationRunwayEvent.objects.filter(
        simulation_runway=simulation_runway,
        event_type=SimulationRunwayEvent.EventType.CLOSED,
    )
    assert closed_events.count() >= 5
    reasons = {event.reason for event in closed_events}
    # Snow's weighting (6 vs 1 vs 1) never rules out the other reasons, but
    # over enough closures the overwhelming majority should be snow-related.
    snow_count = closed_events.filter(reason="Snow clearance").count()
    assert snow_count / closed_events.count() > 0.5


@pytest.mark.django_db
def test_clear_weather_never_closes_for_snow():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations()
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation, runway=runway, operating_mode=SimulationRunway.OperatingMode.MIXED
    )
    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)
    rng = np.random.default_rng(2)
    base_time = timezone.now()

    def to_datetime(now):
        return base_time + timedelta(minutes=float(now))

    env.process(
        closure_process(
            env, rng, simulation_runway, wrapper, to_datetime, Simulation.WeatherCondition.CLEAR
        )
    )
    env.run(until=2000)

    closed_events = SimulationRunwayEvent.objects.filter(
        simulation_runway=simulation_runway,
        event_type=SimulationRunwayEvent.EventType.CLOSED,
    )
    assert closed_events.count() >= 5
    assert not closed_events.filter(reason="Snow clearance").exists()


def _run_engine(helper, weather_condition, **overrides):
    # Unique identifier per call — this helper is called twice (once per
    # weather condition) within the same test's DB/transaction.
    runway = helper.create_runways(1, identifier=f"RW-{weather_condition}")[0]
    defaults = dict(
        arrival_rate_per_hour=60,
        departure_rate_per_hour=60,
        duration_minutes=60,
        max_wait_minutes=8,
        aircraft_speed_knots=140,
        include_closures=False,
        random_seed=123,
        weather_condition=weather_condition,
    )
    defaults.update(overrides)
    simulation = helper.create_simulations(1, **defaults)
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )
    SimulationRunner().run(simulation.id)
    simulation.refresh_from_db()
    return simulation


@pytest.mark.django_db
def test_worse_weather_lowers_throughput_with_an_otherwise_identical_run():
    helper = BaseFeatureTest()

    clear_run = _run_engine(helper, Simulation.WeatherCondition.CLEAR)
    low_visibility_run = _run_engine(helper, Simulation.WeatherCondition.LOW_VISIBILITY)

    clear_successes = Aircraft.objects.filter(
        simulation=clear_run, outcome=Aircraft.Outcome.SUCCESS
    ).count()
    low_visibility_successes = Aircraft.objects.filter(
        simulation=low_visibility_run, outcome=Aircraft.Outcome.SUCCESS
    ).count()

    assert low_visibility_successes < clear_successes


@pytest.mark.django_db
def test_weather_condition_defaults_to_clear():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(1)
    assert simulation.weather_condition == Simulation.WeatherCondition.CLEAR
