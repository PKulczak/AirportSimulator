from rest_framework import serializers

from api.models import Simulation
from api.serializers.simulation_runway_detail_dto import SimulationRunwayDetailDto


class SimulationDetailDto(serializers.ModelSerializer):
    success_rate = serializers.SerializerMethodField()
    outcome_counts = serializers.SerializerMethodField()
    wait_time_stats = serializers.SerializerMethodField()
    delay_stats = serializers.SerializerMethodField()
    queue_depth_stats = serializers.SerializerMethodField()
    runway_stats = serializers.SerializerMethodField()
    closure_event_count = serializers.SerializerMethodField()

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
            "started_at",
            "completed_at",
            "created_at",
            "success_rate",
            "outcome_counts",
            "wait_time_stats",
            "delay_stats",
            "queue_depth_stats",
            "runway_stats",
            "closure_event_count",
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
                    "total_assigned": len(assigned),
                    "success_count": len(success),
                    "closure_count": len(simulation_runway.closure_events.all()),
                }
            )
        return SimulationRunwayDetailDto(stats, many=True).data
