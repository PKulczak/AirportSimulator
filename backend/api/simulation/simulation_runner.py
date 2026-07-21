import logging
from datetime import timedelta

import numpy as np
import simpy
from django.utils import timezone

from api.models import Aircraft, Simulation, SimulationRunway
from api.simulation import constants
from api.simulation.aircraft_data_generator import AircraftDataGenerator
from api.simulation.closures import closure_process
from api.simulation.priority import PriorityTracker
from api.simulation.simulation_runway_wrapper import SimulationRunwayWrapper

logger = logging.getLogger(__name__)


class SimulationRunner:
    """Owns the full lifecycle of running one `Simulation`.

    `run(id)` guarantees the simulation always lands on a terminal status
    (Complete or Error) — any exception raised while building/advancing the
    SimPy environment is caught here and persisted as Status.ERROR, never
    re-raised, so a dramatiq worker never has to retry a partially-run
    simulation.
    """

    def run(self, id):
        try:
            simulation = Simulation.objects.get(id=id)
        except Simulation.DoesNotExist:
            # Nothing to run and nothing to mark Error on — log and return
            # rather than raise, so the dramatiq actor never fails/retries.
            logger.error("Simulation %s not found; nothing to run.", id)
            return

        simulation.status = Simulation.Status.RUNNING
        simulation.started_at = timezone.now()
        simulation.save(update_fields=["status", "started_at"])

        try:
            self._execute(simulation)
        except Exception as exc:  # noqa: BLE001 - intentionally broad, see docstring.
            logger.exception("Simulation %s failed", id)
            simulation.status = Simulation.Status.ERROR
            simulation.error_message = str(exc)
            simulation.completed_at = timezone.now()
            simulation.save(
                update_fields=["status", "error_message", "completed_at"]
            )
            return

        simulation.status = Simulation.Status.COMPLETE
        simulation.completed_at = timezone.now()
        simulation.save(update_fields=["status", "completed_at"])

    # -- setup -----------------------------------------------------------

    def _execute(self, simulation):
        base_time = simulation.started_at
        rng = np.random.default_rng(simulation.random_seed)

        aircraft_entries = AircraftDataGenerator(simulation, base_time).generate()
        aircraft_list = [aircraft for aircraft, _ in aircraft_entries]
        Aircraft.objects.bulk_create(aircraft_list)

        simulation_runways = list(
            SimulationRunway.objects.filter(
                simulation=simulation,
                operational_status=SimulationRunway.OperationalStatus.OPEN,
            ).select_related("runway")
        )

        env = simpy.Environment()

        def to_datetime(env_now):
            return base_time + timedelta(minutes=float(env_now))

        wrappers = [SimulationRunwayWrapper(env, sr) for sr in simulation_runways]

        if simulation.include_closures:
            for sr, wrapper in zip(simulation_runways, wrappers):
                env.process(closure_process(env, rng, sr, wrapper, to_datetime))

        operation_minutes = self._operation_minutes(simulation.aircraft_speed_knots)

        for aircraft, offset in aircraft_entries:
            self._spawn_aircraft_process(
                env, rng, simulation, aircraft, wrappers, offset, to_datetime,
                operation_minutes,
            )

        # Every generated aircraft's own process is bounded by (its scheduled
        # offset + its own wait deadline + at most one runway operation), so
        # running well past the traffic-generation window guarantees every
        # process gets a chance to resolve naturally.
        horizon = simulation.duration_minutes + simulation.max_wait_minutes + (
            operation_minutes * 2
        ) + constants.CLOSURE_MEAN_DURATION_MINUTES
        env.run(until=horizon)

        # Safety net: force-terminate anything that is somehow still pending
        # (should not normally happen; guarantees the "every aircraft reaches a
        # terminal outcome" invariant even under an unforeseen edge case).
        self._force_terminate_stragglers(simulation, to_datetime, env)

    @staticmethod
    def _operation_minutes(aircraft_speed_knots):
        if not aircraft_speed_knots:
            return constants.REFERENCE_OPERATION_MINUTES
        scaled = constants.REFERENCE_OPERATION_MINUTES * (
            constants.REFERENCE_SPEED_KNOTS / float(aircraft_speed_knots)
        )
        return max(constants.MIN_OPERATION_MINUTES, scaled)

    def _force_terminate_stragglers(self, simulation, to_datetime, env):
        stragglers = Aircraft.objects.filter(
            simulation=simulation, outcome=Aircraft.Outcome.PENDING
        )
        now = to_datetime(env.now)
        for aircraft in stragglers:
            outcome = self._deadline_outcome(aircraft)
            aircraft.outcome = outcome
            aircraft.was_success = False
            aircraft.completion_time = now
            aircraft.save(
                update_fields=["outcome", "was_success", "completion_time"]
            )

    @staticmethod
    def _deadline_outcome(aircraft):
        if aircraft.movement_type == Aircraft.MovementType.ARRIVAL:
            return Aircraft.Outcome.DIVERTED
        return Aircraft.Outcome.CANCELLED

    # -- per-aircraft process ---------------------------------------------

    def _spawn_aircraft_process(
        self, env, rng, simulation, aircraft, wrappers, offset, to_datetime,
        operation_minutes,
    ):
        holder = {}

        def gen():
            proc = holder["proc"]
            yield from self._aircraft_process_body(
                env, rng, simulation, aircraft, wrappers, offset, to_datetime,
                operation_minutes, lambda: proc,
            )

        proc = env.process(gen())
        holder["proc"] = proc
        return proc

    def _aircraft_process_body(
        self, env, rng, simulation, aircraft, wrappers, offset, to_datetime,
        operation_minutes, get_proc,
    ):
        if offset > 0:
            yield env.timeout(offset)

        candidate_wrappers = [w for w in wrappers if w.accepts(aircraft.movement_type)]

        if not candidate_wrappers:
            self._finalize(
                aircraft, self._deadline_outcome(aircraft), to_datetime, env
            )
            return

        aircraft.queue_entry_time = to_datetime(env.now)
        aircraft.save(update_fields=["queue_entry_time"])
        queue_entry_sim_time = env.now

        tracker = PriorityTracker()
        is_arrival = aircraft.movement_type == Aircraft.MovementType.ARRIVAL
        fuel_deadline = aircraft.initial_fuel_minutes if is_arrival else float("inf")
        wait_deadline = min(simulation.max_wait_minutes, fuel_deadline)

        state = {"done": False}
        env.process(
            self._emergency_event_process(
                env, rng, aircraft, tracker, state, is_arrival, fuel_deadline,
                queue_entry_sim_time, wait_deadline, to_datetime, get_proc,
            )
        )

        outcome = None
        winner = None

        while outcome is None:
            elapsed = env.now - queue_entry_sim_time
            remaining = wait_deadline - elapsed
            if remaining <= constants.TIME_EPSILON_MINUTES:
                outcome = self._deadline_outcome(aircraft)
                break

            open_candidates = [w for w in candidate_wrappers if w.is_open()]

            if not open_candidates:
                wait_events = [w.reopened_event for w in candidate_wrappers]
                timeout_event = env.timeout(remaining)
                try:
                    yield simpy.events.AnyOf(env, wait_events + [timeout_event])
                except simpy.Interrupt:
                    pass
                continue

            requests = {}
            for w in open_candidates:
                requests[w] = w.resource.request(priority=tracker.score)
                w.register_waiting(get_proc())

            timeout_event = env.timeout(remaining)
            all_events = list(requests.values()) + [timeout_event]

            try:
                result = yield simpy.events.AnyOf(env, all_events)
            except simpy.Interrupt:
                self._cancel_requests(requests)
                continue
            finally:
                for w in requests:
                    w.unregister_waiting(get_proc())

            won_wrapper, won_request = self._pick_winner(requests, result)

            if won_wrapper is None:
                # Only the timeout fired.
                self._cancel_requests(requests)
                continue

            # Release any other requests that happened to also be granted.
            self._cancel_requests(
                {w: r for w, r in requests.items() if w is not won_wrapper}
            )
            winner = (won_wrapper, won_request)
            break

        state["done"] = True

        if winner is None:
            self._finalize(aircraft, outcome, to_datetime, env)
            return

        won_wrapper, won_request = winner
        aircraft.runway = won_wrapper.simulation_runway.runway
        aircraft.runway_assigned_time = to_datetime(env.now)
        aircraft.wait_minutes = env.now - queue_entry_sim_time
        aircraft.final_priority_score = tracker.score
        aircraft.save(
            update_fields=[
                "runway",
                "runway_assigned_time",
                "wait_minutes",
                "final_priority_score",
            ]
        )

        try:
            yield env.timeout(operation_minutes)
        finally:
            won_wrapper.resource.release(won_request)

        self._finalize(aircraft, Aircraft.Outcome.SUCCESS, to_datetime, env)

    @staticmethod
    def _pick_winner(requests, result):
        for w, req in requests.items():
            if req in result:
                return w, req
        return None, None

    @staticmethod
    def _cancel_requests(requests):
        for w, req in requests.items():
            if req.triggered:
                w.resource.release(req)
            else:
                req.cancel()

    def _finalize(self, aircraft, outcome, to_datetime, env):
        aircraft.outcome = outcome
        aircraft.was_success = outcome == Aircraft.Outcome.SUCCESS
        aircraft.completion_time = to_datetime(env.now)
        update_fields = ["outcome", "was_success", "completion_time"]
        if aircraft.wait_minutes is None and aircraft.queue_entry_time is not None:
            elapsed_minutes = (
                aircraft.completion_time - aircraft.queue_entry_time
            ).total_seconds() / 60.0
            aircraft.wait_minutes = elapsed_minutes
            update_fields.append("wait_minutes")
        aircraft.save(update_fields=update_fields)

    # -- emergencies --------------------------------------------------------

    def _emergency_event_process(
        self, env, rng, aircraft, tracker, state, is_arrival, fuel_deadline,
        queue_entry_sim_time, wait_deadline, to_datetime, get_proc,
    ):
        fired_low_fuel = False
        fired_fuel_critical = False

        if is_arrival:
            low_fuel_at = fuel_deadline - constants.LOW_FUEL_THRESHOLD_MINUTES
            critical_fuel_at = fuel_deadline - constants.FUEL_CRITICAL_THRESHOLD_MINUTES

            for threshold_time, event_type, flag_name in (
                (low_fuel_at, "LowFuel", "fired_low_fuel"),
                (critical_fuel_at, "FuelCritical", "fired_fuel_critical"),
            ):
                if state["done"]:
                    return
                delay = threshold_time - (env.now - queue_entry_sim_time)
                if delay <= constants.TIME_EPSILON_MINUTES:
                    continue
                try:
                    yield env.timeout(delay)
                except simpy.Interrupt:
                    return
                if state["done"]:
                    return
                self._record_emergency(aircraft, event_type, tracker, to_datetime, env)
                self._interrupt(get_proc())

        # Probabilistic mechanical-failure / passenger-health checks for the
        # remainder of the wait, applicable to both movement types.
        while not state["done"]:
            elapsed = env.now - queue_entry_sim_time
            remaining = wait_deadline - elapsed
            if remaining <= constants.TIME_EPSILON_MINUTES:
                return
            check_in = min(remaining, constants.EMERGENCY_EVENT_CHECK_INTERVAL_MINUTES)
            try:
                yield env.timeout(check_in)
            except simpy.Interrupt:
                continue
            if state["done"]:
                return
            if rng.random() < constants.EMERGENCY_EVENT_PROBABILITY_PER_CHECK:
                event_type = (
                    "MechanicalFailure"
                    if rng.random() < constants.MECHANICAL_FAILURE_PROBABILITY_WEIGHT
                    else "PassengerHealth"
                )
                self._record_emergency(aircraft, event_type, tracker, to_datetime, env)
                self._interrupt(get_proc())

    @staticmethod
    def _interrupt(proc):
        if proc.is_alive:
            try:
                proc.interrupt("priority_boost")
            except RuntimeError:
                pass

    @staticmethod
    def _record_emergency(aircraft, event_type, tracker, to_datetime, env):
        from api.models import AircraftEvent

        boost = tracker.boost(event_type)
        AircraftEvent.objects.create(
            aircraft=aircraft,
            event_type=event_type,
            occurred_at=to_datetime(env.now),
            priority_boost=constants.EVENT_PRIORITY_BOOSTS.get(event_type, 0),
            detail=f"Priority score now {boost:.1f}",
        )
