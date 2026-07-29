from django.db.models import Count, Max, Min, Q
from rest_framework import serializers

from api.models import Simulation
from api.serializers.simulation_sweep_creation_dto import SWEEPABLE_VARIABLES


class SimulationListDto(serializers.ModelSerializer):
    runway_count = serializers.SerializerMethodField()
    # Reads the model's own `batch_id` column directly (no join to
    # SimulationBatch needed) — null for a run that isn't part of a batch.
    # Lets the history page link back to a sweep's results after leaving it.
    batch_id = serializers.IntegerField(read_only=True)
    batch_summary = serializers.SerializerMethodField()

    class Meta:
        model = Simulation
        fields = [
            "id",
            "name",
            "status",
            "arrival_rate_per_hour",
            "departure_rate_per_hour",
            "duration_minutes",
            "max_wait_minutes",
            "aircraft_speed_knots",
            "include_closures",
            "created_at",
            "completed_at",
            "runway_count",
            "batch_id",
            "batch_summary",
        ]

    def get_runway_count(self, obj):
        # Annotated by SimulationQuerySet.with_runway_count() for the list
        # endpoint; falls back to a direct count for the create-response case,
        # where the serializer runs against a plain (unannotated) instance.
        annotated = getattr(obj, "runway_count", None)
        if annotated is not None:
            return annotated
        return obj.simulation_runways.count()

    def get_batch_summary(self, obj):
        # `obj` here is the batch's *representative* row (SimulationQuerySet
        # .for_history() picks one per batch), so the aggregate below covers
        # every run in the batch, not just this one.
        if obj.batch_id is None:
            return None

        swept_variable = obj.batch.swept_variable
        field_name = SWEEPABLE_VARIABLES.get(swept_variable)
        range_aggregates = (
            {"range_min": Min(field_name), "range_max": Max(field_name)}
            if field_name
            else {}
        )
        counts = Simulation.objects.filter(batch_id=obj.batch_id).aggregate(
            run_count=Count("id"),
            pending_count=Count("id", filter=Q(status=Simulation.Status.PENDING)),
            running_count=Count("id", filter=Q(status=Simulation.Status.RUNNING)),
            complete_count=Count("id", filter=Q(status=Simulation.Status.COMPLETE)),
            error_count=Count("id", filter=Q(status=Simulation.Status.ERROR)),
            cancelled_count=Count("id", filter=Q(status=Simulation.Status.CANCELLED)),
            **range_aggregates,
        )
        return {
            "swept_variable": swept_variable,
            "run_count": counts["run_count"],
            # Keyed by the model's actual status strings ("Pending", not
            # "pending") so this matches the frontend's SimulationStatus union
            # directly — camelCase-izing leaves an already-capitalized,
            # underscore-free key untouched, so no renaming happens in transit.
            "status_counts": {
                Simulation.Status.PENDING.value: counts["pending_count"],
                Simulation.Status.RUNNING.value: counts["running_count"],
                Simulation.Status.COMPLETE.value: counts["complete_count"],
                Simulation.Status.ERROR.value: counts["error_count"],
                Simulation.Status.CANCELLED.value: counts["cancelled_count"],
            },
            "range_min": counts.get("range_min"),
            "range_max": counts.get("range_max"),
        }
