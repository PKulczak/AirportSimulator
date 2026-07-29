from rest_framework import serializers

from api.models import Simulation, SimulationRunwayEvent
from api.serializers.runway_initial_status import initial_operational_status
from api.serializers.simulation_runway_detail_dto import SimulationRunwayDetailDto


class SimulationDetailDto(serializers.ModelSerializer):
    success_rate = serializers.SerializerMethodField()
    outcome_counts = serializers.SerializerMethodField()
    wait_time_stats = serializers.SerializerMethodField()
    delay_stats = serializers.SerializerMethodField()
    queue_depth_stats = serializers.SerializerMethodField()
    runway_stats = serializers.SerializerMethodField()
    closure_event_count = serializers.SerializerMethodField()
    timeline_events = serializers.SerializerMethodField()
    # Null for a run that isn't part of a batch. Lets the detail page's back
    # button return to the sweep's results instead of the history home page.
    batch_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Simulation
        fields = [
            "id",
            "name",
            "status",
            "error_message",
            "arrival_rate_per_hour",
            "departure_rate_per_hour",
            "duration_minutes",
            "max_wait_minutes",
            "aircraft_speed_knots",
            "include_closures",
            "random_seed",
            "started_at",
            "completed_at",
            "created_at",
            "batch_id",
            "success_rate",
            "outcome_counts",
            "wait_time_stats",
            "delay_stats",
            "queue_depth_stats",
            "runway_stats",
            "closure_event_count",
            "timeline_events",
        ]

    def get_success_rate(self, obj):
        total = getattr(obj, "total_aircraft_count", 0) or 0
        if not total:
            return 0.0
        success = getattr(obj, "success_count", 0) or 0
        return round((success / total) * 100, 2)

    def get_outcome_counts(self, obj):
        return {
            "success": getattr(obj, "success_count", 0) or 0,
            "diverted": getattr(obj, "diverted_count", 0) or 0,
            "cancelled": getattr(obj, "cancelled_count", 0) or 0,
            "pending": getattr(obj, "pending_count", 0) or 0,
            "total": getattr(obj, "total_aircraft_count", 0) or 0,
        }

    def get_wait_time_stats(self, obj):
        return {
            "average_minutes": getattr(obj, "avg_wait_minutes", None),
            "max_minutes": getattr(obj, "max_wait_minutes_actual", None),
        }

    def get_delay_stats(self, obj):
        # Queue-join to actual landing/take-off, not scheduled-vs-actual —
        # deliberately excludes the schedule jitter from aircraft generation
        # (that's input noise, not something the airport's queueing caused),
        # and excludes non-Success outcomes (a diverted/cancelled aircraft
        # never landed/took off, so there's nothing to measure).
        def stats_for(movement_type):
            delays = [
                (aircraft.completion_time - aircraft.queue_entry_time).total_seconds() / 60.0
                for aircraft in obj.aircraft.all()
                if aircraft.movement_type == movement_type
                and aircraft.outcome == "Success"
                and aircraft.completion_time is not None
                and aircraft.queue_entry_time is not None
            ]
            if not delays:
                return {"average_minutes": None, "max_minutes": None}
            return {
                "average_minutes": sum(delays) / len(delays),
                "max_minutes": max(delays),
            }

        return {
            "arrival": stats_for("Arrival"),
            "departure": stats_for("Departure"),
        }

    def get_queue_depth_stats(self, obj):
        # Peak simultaneous occupancy of the holding pattern / take-off
        # queue, not an aggregate of individual wait times — a sweep-line
        # over each aircraft's [queue_entry_time, exit_time) interval, where
        # exit is whichever of runway_assigned_time/completion_time actually
        # ended its wait. Exits are sorted before entries at the same
        # instant so a same-tick hand-off isn't double-counted as overlap.
        def peak_for(movement_type):
            events = []
            for aircraft in obj.aircraft.all():
                if aircraft.movement_type != movement_type or aircraft.queue_entry_time is None:
                    continue
                exit_time = aircraft.runway_assigned_time or aircraft.completion_time
                if exit_time is None:
                    continue
                events.append((aircraft.queue_entry_time, 1))
                events.append((exit_time, -1))

            if not events:
                return 0

            events.sort(key=lambda event: (event[0], event[1]))
            current = peak = 0
            for _, delta in events:
                current += delta
                peak = max(peak, current)
            return peak

        return {
            "arrival": peak_for("Arrival"),
            "departure": peak_for("Departure"),
        }

    def get_closure_event_count(self, obj):
        return getattr(obj, "closure_event_count", 0) or 0

    def get_timeline_events(self, obj):
        # Point-in-time incidents for the summary timeline: when an aircraft
        # was diverted/cancelled, and when a runway went down for closure or
        # came back up from one. Each marker is a single instant, not a
        # start/end pair — there's no "un-diverted" counterpart for aircraft
        # either.
        started_at = obj.started_at
        if started_at is None:
            return []

        events = []
        for aircraft in obj.aircraft.all():
            if (
                aircraft.outcome in ("Diverted", "Cancelled")
                and aircraft.completion_time is not None
            ):
                events.append(
                    {
                        "time_minutes": (
                            aircraft.completion_time - started_at
                        ).total_seconds()
                        / 60.0,
                        "type": aircraft.outcome,
                        "runway_identifier": None,
                        "detail": aircraft.callsign,
                    }
                )

        for simulation_runway in obj.simulation_runways.all():
            for closure_event in simulation_runway.closure_events.all():
                events.append(
                    {
                        "time_minutes": (
                            closure_event.occurred_at - started_at
                        ).total_seconds()
                        / 60.0,
                        "type": closure_event.event_type,
                        "runway_identifier": simulation_runway.runway.identifier,
                        "detail": closure_event.reason,
                    }
                )

        events.sort(key=lambda event: event["time_minutes"])
        return events

    @staticmethod
    def _open_minutes(simulation_runway, started_at, duration_minutes):
        # Minutes the runway was open within the simulation's [0, duration]
        # window. Closures are Closed/Reopened event pairs; a trailing Closed
        # with no Reopened means it stayed down to the end. Each interval is
        # clamped to the window so a closure in the post-duration engine tail
        # doesn't count against uptime. With no start reference (e.g. a test
        # fixture that never set started_at) we can't place the events, so we
        # report the runway as fully open — matching get_timeline_events, which
        # also degrades gracefully when started_at is None.
        if started_at is None or not duration_minutes:
            return float(duration_minutes or 0)

        events = sorted(
            simulation_runway.closure_events.all(),
            key=lambda event: event.occurred_at,
        )
        closed_minutes = 0.0
        close_start = None
        for event in events:
            offset = (event.occurred_at - started_at).total_seconds() / 60.0
            offset = min(max(offset, 0.0), duration_minutes)
            if event.event_type == SimulationRunwayEvent.EventType.CLOSED:
                if close_start is None:
                    close_start = offset
            elif close_start is not None:
                closed_minutes += offset - close_start
                close_start = None
        if close_start is not None:
            closed_minutes += duration_minutes - close_start

        return max(0.0, duration_minutes - closed_minutes)

    def get_runway_stats(self, obj):
        # Uses the prefetched relations from SimulationQuerySet.with_detail(),
        # so this is Python-side aggregation, not extra queries.
        all_aircraft = list(obj.aircraft.all())
        stats = []
        for simulation_runway in obj.simulation_runways.all():
            assigned = [
                aircraft
                for aircraft in all_aircraft
                if aircraft.runway_id == simulation_runway.runway_id
            ]
            success = [
                aircraft
                for aircraft in assigned
                if aircraft.outcome == "Success"
            ]
            stats.append(
                {
                    "runway_id": simulation_runway.runway_id,
                    "identifier": simulation_runway.runway.identifier,
                    "operating_mode": simulation_runway.operating_mode,
                    "operational_status": simulation_runway.operational_status,
                    "initial_operational_status": initial_operational_status(
                        simulation_runway, obj.started_at
                    ),
                    "total_assigned": len(assigned),
                    "success_count": len(success),
                    "closure_count": len(simulation_runway.closure_events.all()),
                    "open_minutes": self._open_minutes(
                        simulation_runway, obj.started_at, obj.duration_minutes
                    ),
                }
            )
        return SimulationRunwayDetailDto(stats, many=True).data
