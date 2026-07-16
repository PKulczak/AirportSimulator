from api.models import SimulationRunwayEvent
from api.simulation import constants


def closure_process(env, rng, simulation_runway, wrapper, to_datetime):
    """Runs for the lifetime of the run for a single (open) runway, only ever
    scheduled when `Simulation.include_closures` is True.

    On a `rng.exponential`-timed interval: flips the runway Closed, writes a
    `SimulationRunwayEvent(Closed)`, interrupts any aircraft still queued for it
    (via `wrapper.close()` — never one already mid-operation), holds for a
    random duration, then reopens + writes a `Reopened` event.
    """
    while True:
        interval = rng.exponential(constants.CLOSURE_MEAN_INTERVAL_MINUTES)
        yield env.timeout(interval)

        wrapper.close()
        simulation_runway.operational_status = (
            simulation_runway.OperationalStatus.CLOSED
        )
        simulation_runway.save(update_fields=["operational_status"])
        SimulationRunwayEvent.objects.create(
            simulation_runway=simulation_runway,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
            occurred_at=to_datetime(env.now),
            reason="Random closure",
        )

        duration = max(
            constants.CLOSURE_MIN_DURATION_MINUTES,
            rng.exponential(constants.CLOSURE_MEAN_DURATION_MINUTES),
        )
        yield env.timeout(duration)

        wrapper.reopen()
        simulation_runway.operational_status = (
            simulation_runway.OperationalStatus.OPEN
        )
        simulation_runway.save(update_fields=["operational_status"])
        SimulationRunwayEvent.objects.create(
            simulation_runway=simulation_runway,
            event_type=SimulationRunwayEvent.EventType.REOPENED,
            occurred_at=to_datetime(env.now),
            reason="Random closure ended",
        )
