import pytest
import simpy

from api.models import SimulationRunway
from api.simulation.simulation_runway_wrapper import SimulationRunwayWrapper
from tests.base_test import BaseFeatureTest


class FakeProcess:
    """A minimal stand-in for a simpy Process, to test wrapper interrupt
    plumbing without needing a fully running Environment."""

    def __init__(self):
        self.is_alive = True
        self.interrupted_with = None

    def interrupt(self, cause=None):
        self.interrupted_with = cause


def _make_wrapper(operating_mode):
    helper = BaseFeatureTest()
    simulation = helper.create_simulations()
    runway = helper.create_runways(1)[0]
    simulation_runway = helper.create_simulation_runway(
        simulation=simulation, runway=runway, operating_mode=operating_mode
    )
    env = simpy.Environment()
    return SimulationRunwayWrapper(env, simulation_runway)


@pytest.mark.django_db
def test_mixed_mode_accepts_both_movement_types():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.MIXED)
    assert wrapper.accepts("Arrival") is True
    assert wrapper.accepts("Departure") is True


@pytest.mark.django_db
def test_arrivals_only_rejects_departures():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.ARRIVALS_ONLY)
    assert wrapper.accepts("Arrival") is True
    assert wrapper.accepts("Departure") is False


@pytest.mark.django_db
def test_departures_only_rejects_arrivals():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.DEPARTURES_ONLY)
    assert wrapper.accepts("Departure") is True
    assert wrapper.accepts("Arrival") is False


@pytest.mark.django_db
def test_starts_open_and_close_marks_closed():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.MIXED)
    assert wrapper.is_open() is True

    wrapper.close()

    assert wrapper.is_open() is False
    assert wrapper.closed is True


@pytest.mark.django_db
def test_reopen_marks_open_again():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.MIXED)
    wrapper.close()
    wrapper.reopen()
    assert wrapper.is_open() is True


@pytest.mark.django_db
def test_close_interrupts_only_queued_processes():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.MIXED)
    queued_process = FakeProcess()
    wrapper.register_waiting(queued_process)

    wrapper.close()

    assert queued_process.interrupted_with == "runway_closed"


@pytest.mark.django_db
def test_unregistered_process_is_not_interrupted_on_close():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.MIXED)
    queued_process = FakeProcess()
    wrapper.register_waiting(queued_process)
    wrapper.unregister_waiting(queued_process)

    wrapper.close()

    assert queued_process.interrupted_with is None


@pytest.mark.django_db
def test_dead_process_is_not_interrupted_on_close():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.MIXED)
    queued_process = FakeProcess()
    queued_process.is_alive = False
    wrapper.register_waiting(queued_process)

    wrapper.close()

    assert queued_process.interrupted_with is None


@pytest.mark.django_db
def test_reopen_fires_reopened_event():
    wrapper = _make_wrapper(SimulationRunway.OperatingMode.MIXED)
    wrapper.close()
    previous_event = wrapper.reopened_event

    wrapper.reopen()

    assert previous_event.triggered is True
    assert wrapper.reopened_event is not previous_event
    assert wrapper.reopened_event.triggered is False
