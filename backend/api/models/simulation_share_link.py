from django.db import models

# Not just an import of api.models.share_link_token.generate_share_token: the
# 0014 migration's `token` field default already froze a reference to this
# exact name at this exact path, so renaming/moving it would break replaying
# that migration on a fresh database. The two newer share-link models (no
# migration history to preserve) use the shared helper directly instead.
from api.models.share_link_token import generate_share_token as _generate_token


class SimulationShareLink(models.Model):
    """A shareable, unguessable token granting read-only access to one run's
    detail + visualisation + CSV export without an account (see
    SharedSimulationDetailView/SharedSimulationVisualisationView/
    SharedSimulationExportCsvView) — nothing else about the API honours it.
    One link per simulation, created lazily and reused (get_or_create) by
    SimulationViewset.share, mirroring the auth token's get_or_create pattern.
    CASCADE on delete: a share link with no simulation behind it is meaningless.
    """

    simulation = models.OneToOneField(
        "api.Simulation", on_delete=models.CASCADE, related_name="share_link"
    )
    token = models.CharField(max_length=64, unique=True, default=_generate_token)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"share link for simulation {self.simulation_id}"
