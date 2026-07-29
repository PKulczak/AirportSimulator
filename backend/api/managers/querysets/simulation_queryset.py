from django.db.models import Avg, Count, Max, Min, Q, QuerySet


class SimulationQuerySet(QuerySet):
    def with_detail(self):
        """Annotate each Simulation with aggregate stats used by the detail endpoint.

        Uses `distinct=True` on every Count because the queryset also joins onto
        `simulation_runways__closure_events`, which would otherwise fan out the
        aircraft-outcome counts.
        """
        return self.annotate(
            total_aircraft_count=Count("aircraft", distinct=True),
            success_count=Count(
                "aircraft",
                filter=Q(aircraft__outcome="Success"),
                distinct=True,
            ),
            diverted_count=Count(
                "aircraft",
                filter=Q(aircraft__outcome="Diverted"),
                distinct=True,
            ),
            cancelled_count=Count(
                "aircraft",
                filter=Q(aircraft__outcome="Cancelled"),
                distinct=True,
            ),
            pending_count=Count(
                "aircraft",
                filter=Q(aircraft__outcome="Pending"),
                distinct=True,
            ),
            avg_wait_minutes=Avg("aircraft__wait_minutes"),
            max_wait_minutes_actual=Max("aircraft__wait_minutes"),
            closure_event_count=Count(
                "simulation_runways__closure_events", distinct=True
            ),
        ).prefetch_related(
            "aircraft",
            "aircraft__events",
            "simulation_runways",
            "simulation_runways__runway",
            "simulation_runways__closure_events",
        )

    def with_detail_for_ids(self, ids):
        """Same annotations as with_detail(), scoped to a specific set of ids —
        lets the batched compare endpoint fetch N runs' metrics in one query
        instead of the frontend making N separate /detail/ calls.
        """
        return self.with_detail().filter(id__in=ids)

    def in_batch(self, batch_id):
        return self.filter(batch_id=batch_id)

    def with_detail_for_batch(self, batch_id):
        """Same annotations as with_detail(), scoped to one batch and ordered
        ascending by id (creation order) — a sweep's steps are created in
        ascending-variable order, so this is also the sweep's step order.
        """
        return self.with_detail().filter(batch_id=batch_id).order_by("id")

    def with_runway_count(self):
        # `annotate()` with an aggregate silently drops the model's default
        # `Meta.ordering` (Django re-derives ordering around the GROUP BY it
        # adds), so re-assert it explicitly — otherwise the list endpoint
        # stops returning newest-first.
        return self.annotate(
            runway_count=Count("simulation_runways", distinct=True)
        ).order_by("-created_at")

    def for_history(self):
        """One row per *history item* for the list endpoint: a standalone
        Simulation, or the earliest-created representative of each batch.

        A sweep's N runs are all created inside one request/transaction
        (`SimulationSweepCreationDto.create()`), so they're always contiguous
        in creation order — nothing else can be created in between them —
        which is what makes "collapse to the batch's first row" safe here
        rather than needing to worry about interleaved unrelated rows.
        """
        representative_ids = (
            self.filter(batch_id__isnull=False)
            .values("batch_id")
            .annotate(first_id=Min("id"))
            .values_list("first_id", flat=True)
        )
        return (
            self.filter(Q(batch_id__isnull=True) | Q(id__in=representative_ids))
            .select_related("batch")
            .with_runway_count()
        )

    def for_visualisation(self):
        return self.prefetch_related(
            "aircraft",
            "aircraft__events",
            "aircraft__runway",
            "simulation_runways",
            "simulation_runways__runway",
            "simulation_runways__closure_events",
        )
