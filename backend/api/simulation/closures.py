from api.models import SimulationRunway, SimulationRunwayEvent
from api.simulation import constants

# Random closures pick one of these named reasons (never `AVAILABLE` — that's
# the "not closed" state) so replay/metrics can show *why* a runway went down,
# not just that it did.
CLOSURE_REASON_LABELS = {
    SimulationRunway.OperationalStatus.RUNWAY_INSPECTION: "Runway inspection",
    SimulationRunway.OperationalStatus.SNOW_CLEARANCE: "Snow clearance",
    SimulationRunway.OperationalStatus.EQUIPMENT_FAILURE: "Equipment failure",
}


def closure_process(env, rng, simulation_runway, wrapper, to_datetime):
    """Runs for the lifetime of the run for a single (open) runway, only ever
    scheduled when `Simulation.include_closures` is True.

    On a `rng.exponential`-timed interval: flips the runway to a randomly
    chosen closed reason, writes a `SimulationRunwayEvent(Closed)` naming that
    reason, interrupts any aircraft still queued for it (via `wrapper.close()`
    — never one already mid-operation), holds for a random duration, then
    reopens + writes a `Reopened` event referencing the same reason.
    """
    closed_statuses = list(CLOSURE_REASON_LABELS.keys())

    while True:
        interval = rng.exponential(constants.CLOSURE_MEAN_INTERVAL_MINUTES)
        yield env.timeout(interval)

        status = closed_statuses[rng.integers(len(closed_statuses))]
        label = CLOSURE_REASON_LABELS[status]

        wrapper.close()
        simulation_runway.operational_status = status
        simulation_runway.save(update_fields=["operational_status"])
        SimulationRunwayEvent.objects.create(
            simulation_runway=simulation_runway,
            event_type=SimulationRunwayEvent.EventType.CLOSED,
            occurred_at=to_datetime(env.now),
            reason=label,
        )

        duration = max(
            constants.CLOSURE_MIN_DURATION_MINUTES,
            rng.exponential(constants.CLOSURE_MEAN_DURATION_MINUTES),
        )
        yield env.timeout(duration)

        wrapper.reopen()
        simulation_runway.operational_status = (
            simulation_runway.OperationalStatus.AVAILABLE
        )
        simulation_runway.save(update_fields=["operational_status"])
        SimulationRunwayEvent.objects.create(
            simulation_runway=simulation_runway,
            event_type=SimulationRunwayEvent.EventType.REOPENED,
            occurred_at=to_datetime(env.now),
            reason=f"{label} resolved",
        )
