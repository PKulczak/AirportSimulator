from django.db import models, transaction


class SimulationManager(models.Manager):
    def create(self, *, runways=None, **kwargs):
        """Atomically create a Simulation plus its SimulationRunway rows.

        `runways` is an optional list of dicts:
        [{"runway_id": int, "operating_mode": str, "operational_status": str}, ...]
        (`operational_status` defaults to Available if omitted).
        Kept as a plain `create()` override (rather than a separately named method) so callers
        that don't need runways can still do `Simulation.objects.create(**fields)` unchanged.
        """
        from api.models.simulation_runway import SimulationRunway

        with transaction.atomic():
            simulation = super().create(**kwargs)
            if runways:
                SimulationRunway.objects.bulk_create(
                    [
                        SimulationRunway(
                            simulation=simulation,
                            runway_id=runway["runway_id"],
                            operating_mode=runway["operating_mode"],
                            operational_status=runway.get(
                                "operational_status", SimulationRunway.OperationalStatus.AVAILABLE
                            ),
                        )
                        for runway in runways
                    ]
                )
        return simulation
