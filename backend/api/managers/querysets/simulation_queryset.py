from django.db.models import Avg, Count, Max, Q, QuerySet


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

    def for_visualisation(self):
        return self.prefetch_related(
            "aircraft",
            "aircraft__events",
            "aircraft__runway",
            "simulation_runways",
            "simulation_runways__runway",
            "simulation_runways__closure_events",
        )
