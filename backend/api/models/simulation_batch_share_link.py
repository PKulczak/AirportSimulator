from django.db import models

from api.models.share_link_token import generate_share_token


class SimulationBatchShareLink(models.Model):
    """A shareable, unguessable token granting read-only access to a whole
    batch/sweep's results (see SharedBatchResultsView) — the batch/sweep
    counterpart to SimulationShareLink. One link per batch, created lazily and
    reused (get_or_create) by SimulationViewset.batch_share. CASCADE on
    delete: a share link with no batch behind it is meaningless.
    """

    batch = models.OneToOneField(
        "api.SimulationBatch", on_delete=models.CASCADE, related_name="share_link"
    )
    token = models.CharField(max_length=64, unique=True, default=generate_share_token)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"share link for batch {self.batch_id}"
