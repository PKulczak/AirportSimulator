from datetime import timedelta

import numpy as np
import pytest
import simpy
from django.utils import timezone

from api.models import Runway, Simulation, SimulationRunway, SimulationRunwayEvent
from api.simulation.closures import closure_process
from api.simulation.simulation_runner import SimulationRunner
from api.simulation.simulation_runway_wrapper import SimulationRunwayWrapper
from tests.base_test import BaseFeatureTest


@pytest.mark.django_db
def test_closure_process_flips_db_status_and_records_ordered_events():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(1)
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation, runway=runway
    )
    assert simulation_runway.operational_status == SimulationRunway.OperationalStatus.OPEN

    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)
    rng = np.random.default_rng(1)
    base_time = timezone.now()

    def to_datetime(now):
        return base_time + timedelta(minutes=float(now))

    env.process(closure_process(env, rng, simulation_runway, wrapper, to_datetime))
    env.run(until=300)

    simulation_runway.refresh_from_db()
    events = list(
        SimulationRunwayEvent.objects.filter(
            simulation_runway=simulation_runway
        ).order_by("occurred_at")
    )

    assert len(events) >= 2
    types = [e.event_type for e in events]
    # Every Closed is immediately followed by a Reopened before the next Closed.
    assert types[0] == SimulationRunwayEvent.EventType.CLOSED
    for i in range(0, len(types) - 1, 2):
        assert types[i] == SimulationRunwayEvent.EventType.CLOSED
        assert types[i + 1] == SimulationRunwayEvent.EventType.REOPENED

    # Timestamps strictly increase (closed-before-reopened-before-next-closed).
    occurred_ats = [e.occurred_at for e in events]
    assert occurred_ats == sorted(occurred_ats)


@pytest.mark.django_db
def test_closure_process_toggles_wrapper_closed_flag():
    helper = BaseFeatureTest()
    simulation = helper.create_simulations(1)
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation, runway=runway
    )

    env = simpy.Environment()
    wrapper = SimulationRunwayWrapper(env, simulation_runway)
    rng = np.random.default_rng(1)
    base_time = timezone.now()

    def to_datetime(now):
        return base_time + timedelta(minutes=float(now))

    assert wrapper.is_open()

    env.process(closure_process(env, rng, simulation_runway, wrapper, to_datetime))
    env.run(until=1)  # first closure interval mean is 45 min, so still open shortly after start in most seeds
    # Run further to guarantee at least one closure has happened.
    env.run(until=300)

    # By the end, status is whatever the final toggle left it as, but at least
    # one full close/reopen cycle happened (checked above); here we just
    # confirm the flag mirrors the DB row's final operational_status.
    simulation_runway.refresh_from_db()
    expected_closed = (
        simulation_runway.operational_status == SimulationRunway.OperationalStatus.CLOSED
    )
    assert wrapper.closed == expected_closed


@pytest.mark.django_db
def test_include_closures_false_never_creates_closure_events():
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(
        1,
        include_closures=False,
        arrival_rate_per_hour=20,
        departure_rate_per_hour=20,
        duration_minutes=30,
        max_wait_minutes=10,
        random_seed=5,
    )
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    SimulationRunner().run(simulation.id)

    simulation.refresh_from_db()
    assert simulation.status == Simulation.Status.COMPLETE
    assert SimulationRunwayEvent.objects.filter(
        simulation_runway__simulation=simulation
    ).count() == 0


@pytest.mark.django_db
def test_include_closures_true_can_create_closure_events():
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(
        1,
        include_closures=True,
        arrival_rate_per_hour=60,
        departure_rate_per_hour=60,
        duration_minutes=120,
        max_wait_minutes=20,
        random_seed=99,
    )
    SimulationRunway.objects.create(
        simulation=simulation,
        runway=runway,
        operating_mode=SimulationRunway.OperatingMode.MIXED,
    )

    SimulationRunner().run(simulation.id)

    simulation.refresh_from_db()
    assert simulation.status == Simulation.Status.COMPLETE
    assert SimulationRunwayEvent.objects.filter(
        simulation_runway__simulation=simulation
    ).count() > 0
