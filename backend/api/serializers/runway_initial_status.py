from api.models import SimulationRunway, SimulationRunwayEvent


def initial_operational_status(simulation_runway, started_at):
    """The operational status a runway was *configured* with at creation.

    `SimulationRunway.operational_status` is mutated at runtime by random
    closures (closures.py), so after a run it may reflect an end-of-run closed
    state rather than the initial config. A runway that started closed gets a
    CLOSED event stamped exactly at `started_at` and is never toggled by a
    closure process, so its stored status stays the initial one; anything else
    started Available. With no start reference we can't place events, so fall
    back to the stored status.

    Relies on `simulation_runway.closure_events` being prefetched (the detail
    and config querysets both do), so this adds no per-runway query.
    """
    if started_at is None:
        return simulation_runway.operational_status
    started_closed = any(
        event.event_type == SimulationRunwayEvent.EventType.CLOSED
        and event.occurred_at == started_at
        for event in simulation_runway.closure_events.all()
    )
    if started_closed:
        return simulation_runway.operational_status
    return SimulationRunway.OperationalStatus.AVAILABLE
