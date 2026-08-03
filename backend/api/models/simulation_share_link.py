import secrets

from django.db import models


def _generate_token():
    # url-safe, ~43 chars from 32 random bytes — long/random enough that
    # knowing it is itself the credential for read-only access (Slice 10.1).
    return secrets.token_urlsafe(32)


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
