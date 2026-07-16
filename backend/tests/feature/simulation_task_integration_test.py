import pytest

from api.models import Aircraft, Simulation
from api.tasks import run_simulation
from tests.base_test import BaseFeatureTest


@pytest.mark.django_db(transaction=True)
def test_run_simulation_task_completes_and_persists_aircraft(broker, worker):
    helper = BaseFeatureTest()
    runway = helper.create_runways(1)[0]
    simulation = helper.create_simulations(
        1,
        arrival_rate_per_hour=30,
        departure_rate_per_hour=0,
        duration_minutes=30,
        max_wait_minutes=10,
        random_seed=42,
    )
    helper.create_simulation_runway(simulation=simulation, runway=runway)

    run_simulation.send(simulation.id)
    broker.join(run_simulation.queue_name)
    worker.join()

    simulation.refresh_from_db()
    assert simulation.status == Simulation.Status.COMPLETE
    assert simulation.started_at is not None
    assert simulation.completed_at is not None

    aircraft = Aircraft.objects.filter(simulation=simulation)
    assert aircraft.count() > 0
    assert not aircraft.filter(outcome=Aircraft.Outcome.PENDING).exists()


@pytest.mark.django_db(transaction=True)
def test_run_simulation_task_error_path_never_leaves_status_pending(broker, worker):
    # An id that doesn't exist should be handled by SimulationRunner's broad
    # except-and-persist-Error path, not raise out of the actor.
    run_simulation.send(999999)
    broker.join(run_simulation.queue_name)
    worker.join()
    # No assertion beyond "did not raise" — dramatiq's worker.join() would
    # surface unexpected exceptions via the broker's dead-letter queue only if
    # the message actually failed; SimulationRunner.run() must never propagate.
    assert broker.dead_letters == []
