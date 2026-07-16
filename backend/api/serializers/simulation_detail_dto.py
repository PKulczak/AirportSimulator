from rest_framework import serializers

from api.models import Simulation
from api.serializers.simulation_runway_detail_dto import SimulationRunwayDetailDto


class SimulationDetailDto(serializers.ModelSerializer):
    success_rate = serializers.SerializerMethodField()
    outcome_counts = serializers.SerializerMethodField()
    wait_time_stats = serializers.SerializerMethodField()
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
