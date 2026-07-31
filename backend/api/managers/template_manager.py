from django.db import models, transaction


class TemplateManager(models.Manager):
    def create(self, *, runways=None, **kwargs):
        """Atomically create a Template plus its TemplateRunway rows.

        `runways` is an optional list of dicts:
        [{"runway_id": int, "operating_mode": str, "operational_status": str}, ...]
        (`operational_status` defaults to Available if omitted). Mirrors
        `SimulationManager.create` exactly — kept as a plain `create()`
        override (rather than a separately named method) so callers that
        don't need runways can still do `Template.objects.create(**fields)`
        unchanged.
        """
        from api.models.simulation_runway import SimulationRunway
        from api.models.template_runway import TemplateRunway

        with transaction.atomic():
            template = super().create(**kwargs)
            if runways:
                TemplateRunway.objects.bulk_create(
                    [
                        TemplateRunway(
                            template=template,
                            runway_id=runway["runway_id"],
                            operating_mode=runway["operating_mode"],
                            operational_status=runway.get(
                                "operational_status", SimulationRunway.OperationalStatus.AVAILABLE
                            ),
                        )
                        for runway in runways
                    ]
                )
        return template
