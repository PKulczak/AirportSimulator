import simpy


class SimulationRunwayWrapper:
    """Wraps a single `SimulationRunway` row with the SimPy resource used to
    model it, plus bookkeeping so that a runway closure can interrupt aircraft
    that are still queued for this runway without touching an aircraft that is
    already mid-operation (holding the resource).
    """

    def __init__(self, env, simulation_runway):
        self.env = env
        self.simulation_runway = simulation_runway
        self.resource = simpy.PriorityResource(env, capacity=1)
        self.closed = False
        # Weight class of the aircraft that most recently held this runway,
        # and the sim-time its operation ended — the wake-separation minima
        # the *next* operation must respect are computed from these (see
        # SimulationRunner._wake_separation_extra_minutes). None until this
        # runway has hosted its first operation.
        self.last_operation_class = None
        self.last_operation_end_time = None
        # An *insertion-ordered* set of queued processes (dict-as-ordered-set):
        # a plain `set` iterates process objects in id()/hash order, which
        # varies between runs, so `close()` would interrupt queued aircraft in a
        # nondeterministic order — changing which one re-wins the runway and
        # silently breaking same-seed reproducibility for closure-enabled runs.
        self._queued_processes = {}
        # Replaced with a fresh, unfired event every time the runway reopens,
        # so a process waiting on "notify me when this runway next reopens"
        # can just yield this and re-check the world afterwards.
        self.reopened_event = env.event()

    @property
    def runway_id(self):
        return self.simulation_runway.runway_id

    @property
    def identifier(self):
        return self.simulation_runway.runway.identifier

    def accepts(self, movement_type):
        return self.simulation_runway.accepts(movement_type)

    def is_open(self):
        return not self.closed

    def register_waiting(self, process):
        """Track a process that is currently queued (not yet holding the
        resource) for this runway, so `close()` can interrupt it."""
        self._queued_processes[process] = None

    def unregister_waiting(self, process):
        self._queued_processes.pop(process, None)

    def close(self):
        """Mark the runway closed and interrupt every process still queued for
        it. Never touches a process that already holds the resource (i.e. is
        mid-operation) since those aren't in `_queued_processes`."""
        self.closed = True
        for process in list(self._queued_processes):
            if process.is_alive:
                try:
                    process.interrupt("runway_closed")
                except RuntimeError:
                    # Process already handling another interrupt / finished.
                    pass
        self._queued_processes.clear()

    def reopen(self):
        self.closed = False
        if not self.reopened_event.triggered:
            self.reopened_event.succeed()
        self.reopened_event = self.env.event()
