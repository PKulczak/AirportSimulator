from django.db import models

from api.models.share_link_token import generate_share_token


class CompareShareLink(models.Model):
    """A shareable, unguessable token granting read-only access to an ad-hoc
    comparison of several runs (see SharedCompareView) — the compare-view
    counterpart to SimulationShareLink/SimulationBatchShareLink. Unlike those,
    a compare set isn't backed by one durable model, so `simulation_ids` is
    stored directly rather than as a foreign key; if a run is later deleted,
    SharedCompareView just serves whichever of the remaining ids still exist
    (same "silently drop what's missing" behaviour as SimulationViewset.compare).
    `simulation_ids` is always created sorted+deduped (see
    SimulationViewset.compare_share) so two requests for the same set of runs
    are idempotent regardless of the order they were selected in.
    """

    simulation_ids = models.JSONField()
    token = models.CharField(max_length=64, unique=True, default=generate_share_token)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"share link for comparing {self.simulation_ids}"
