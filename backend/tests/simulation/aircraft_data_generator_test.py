import pytest
from django.utils import timezone

from api.models import Simulation
from api.simulation.aircraft_data_generator import AircraftDataGenerator


def _make_simulation(**overrides):
    defaults = {
        "name": "gen-test",
        "arrival_rate_per_hour": 20,
        "departure_rate_per_hour": 10,
        "duration_minutes": 60,
        "max_wait_minutes": 15,
        "aircraft_speed_knots": 140,
        "random_seed": 7,
    }
    defaults.update(overrides)
    return Simulation.objects.create(**defaults)


@pytest.mark.django_db
def test_seeded_generation_is_deterministic():
    base_time = timezone.now()
    sim1 = _make_simulation()
    sim2 = _make_simulation()

    result1 = AircraftDataGenerator(sim1, base_time).generate()
    result2 = AircraftDataGenerator(sim2, base_time).generate()

    assert len(result1) > 0
    assert len(result1) == len(result2)
    for (a1, offset1), (a2, offset2) in zip(result1, result2):
        assert a1.callsign == a2.callsign
        assert a1.operator == a2.operator
        assert a1.scheduled_time == a2.scheduled_time
        assert a1.movement_type == a2.movement_type
        assert a1.initial_fuel_minutes == a2.initial_fuel_minutes
        assert offset1 == offset2


@pytest.mark.django_db
def test_different_seeds_produce_different_output():
    base_time = timezone.now()
    sim1 = _make_simulation(random_seed=1)
    sim2 = _make_simulation(random_seed=2)

    result1 = AircraftDataGenerator(sim1, base_time).generate()
    result2 = AircraftDataGenerator(sim2, base_time).generate()

    callsigns1 = [a.callsign for a, _ in result1]
    callsigns2 = [a.callsign for a, _ in result2]
    assert callsigns1 != callsigns2


@pytest.mark.django_db
def test_duration_boundary_not_exceeded():
    base_time = timezone.now()
    sim = _make_simulation(
        arrival_rate_per_hour=200, departure_rate_per_hour=150, duration_minutes=30
    )

    result = AircraftDataGenerator(sim, base_time).generate()

    assert len(result) > 0
    for aircraft, actual_offset_minutes in result:
        target_offset_minutes = (aircraft.scheduled_time - base_time).total_seconds() / 60
        assert target_offset_minutes <= sim.duration_minutes
        assert actual_offset_minutes >= 0


@pytest.mark.django_db
def test_zero_rate_generates_no_aircraft_for_that_movement_type():
    base_time = timezone.now()
    sim = _make_simulation(arrival_rate_per_hour=0, departure_rate_per_hour=0)

    result = AircraftDataGenerator(sim, base_time).generate()

    assert result == []


@pytest.mark.django_db
def test_only_arrivals_when_departure_rate_zero():
    base_time = timezone.now()
    sim = _make_simulation(arrival_rate_per_hour=30, departure_rate_per_hour=0)

    result = AircraftDataGenerator(sim, base_time).generate()

    assert len(result) > 0
    assert all(a.movement_type == "Arrival" for a, _ in result)


@pytest.mark.django_db
def test_generated_aircraft_sorted_by_scheduled_time():
    base_time = timezone.now()
    sim = _make_simulation(arrival_rate_per_hour=40, departure_rate_per_hour=30)

    result = AircraftDataGenerator(sim, base_time).generate()

    scheduled_times = [a.scheduled_time for a, _ in result]
    assert scheduled_times == sorted(scheduled_times)


@pytest.mark.django_db
def test_generated_aircraft_have_realistic_fields():
    base_time = timezone.now()
    sim = _make_simulation()

    result = AircraftDataGenerator(sim, base_time).generate()

    for aircraft, _ in result[:10]:
        assert aircraft.callsign
        assert aircraft.callsign.isascii()
        assert aircraft.operator
        assert len(aircraft.origin_destination) == 3
        assert aircraft.initial_fuel_minutes > 0
        assert aircraft.simulation_id == sim.id


@pytest.mark.django_db
def test_initial_fuel_is_uniform_20_to_60_minutes():
    base_time = timezone.now()
    sim = _make_simulation(
        arrival_rate_per_hour=60, departure_rate_per_hour=60, duration_minutes=300
    )

    result = AircraftDataGenerator(sim, base_time).generate()
    assert len(result) > 50

    for aircraft, _ in result:
        assert 20 <= aircraft.initial_fuel_minutes <= 60


@pytest.mark.django_db
def test_scheduled_times_are_evenly_spaced_targets():
    """`scheduled_time` should be the nominal, evenly-spaced target
    (60 / rate_per_hour minutes apart) — not jittered — so a future
    scheduled-vs-actual delay metric has a stable baseline to compare
    against."""
    base_time = timezone.now()
    sim = _make_simulation(
        arrival_rate_per_hour=60, departure_rate_per_hour=0, duration_minutes=120
    )

    result = AircraftDataGenerator(sim, base_time).generate()

    expected_interval = 60.0 / sim.arrival_rate_per_hour
    for index, (aircraft, _) in enumerate(result, start=1):
        target_offset_minutes = (aircraft.scheduled_time - base_time).total_seconds() / 60
        assert target_offset_minutes == pytest.approx(index * expected_interval)


@pytest.mark.django_db
def test_actual_offset_jitters_around_target_with_bounded_deviation():
    """The actual (process-triggering) offset should be Normal(0, 5) jitter
    around the scheduled target — centred on zero deviation across many
    samples, and never wildly far from the target."""
    base_time = timezone.now()
    sim = _make_simulation(
        arrival_rate_per_hour=60, departure_rate_per_hour=0, duration_minutes=600
    )

    result = AircraftDataGenerator(sim, base_time).generate()
    assert len(result) > 100

    deviations = []
    for aircraft, actual_offset_minutes in result:
        target_offset_minutes = (aircraft.scheduled_time - base_time).total_seconds() / 60
        deviations.append(actual_offset_minutes - target_offset_minutes)

    average_deviation = sum(deviations) / len(deviations)
    assert average_deviation == pytest.approx(0.0, abs=2.0)
    assert all(abs(d) < 30 for d in deviations)  # ~6 std devs, generous bound
