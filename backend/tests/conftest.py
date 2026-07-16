import dramatiq
import pytest


@pytest.fixture
def broker():
    """The global broker configured by django_dramatiq at app boot time.

    `tests/settings_test.py` sets `DRAMATIQ_BROKER` to dramatiq's StubBroker, and
    django_dramatiq's AppConfig.ready() sets that as the process-wide broker
    *before* `api/tasks.py` is autodiscovered/imported, so `run_simulation` is
    already bound to this exact broker instance. We must reuse it (rather than
    constructing a fresh StubBroker here) or the worker fixture below would
    listen on a queue the actor never publishes to.
    """
    broker = dramatiq.get_broker()
    broker.flush_all()
    yield broker
    broker.flush_all()


@pytest.fixture
def worker(broker):
    worker = dramatiq.Worker(broker, worker_timeout=100)
    worker.start()
    yield worker
    worker.stop()
