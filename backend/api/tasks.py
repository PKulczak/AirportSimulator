import dramatiq


@dramatiq.actor(max_retries=0)
def run_simulation(id):
    """Dramatiq actor entrypoint for running a queued Simulation.

    Deliberately `max_retries=0`: SimulationRunner.run() already fully owns its
    own failure path (any exception is caught and persisted as Simulation.status
    = Error), so a dramatiq-level retry would just re-run a simulation that has
    already partially written Aircraft rows, corrupting the result.
    """
    from api.simulation.simulation_runner import SimulationRunner

    SimulationRunner().run(id)
