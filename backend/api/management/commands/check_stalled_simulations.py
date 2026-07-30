from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from api.models import Simulation
from api.notifications import publish_simulation_status
from api.simulation import constants


class Command(BaseCommand):
    help = (
        "Marks any Simulation stuck in Running with no heartbeat update "
        "within the stale-run timeout as Error, so a dead/stray worker "
        "doesn't leave it Running forever. Intended to be run periodically "
        "(cron, a scheduled task, a looping sidecar process, etc.) — this "
        "command itself does not loop."
    )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timezone.timedelta(
            minutes=constants.STALLED_RUN_TIMEOUT_REAL_MINUTES
        )
        # Normally last_heartbeat_at is always set the moment a run becomes
        # Running (see SimulationRunner.run), so the first branch covers
        # every real run. The second is a fallback for a Running row that
        # somehow has no heartbeat at all (e.g. pre-existing data from before
        # this field existed) — fall back to started_at so it isn't ignored
        # forever for lack of a heartbeat.
        stalled = Simulation.objects.filter(status=Simulation.Status.RUNNING).filter(
            Q(last_heartbeat_at__lt=cutoff)
            | Q(last_heartbeat_at__isnull=True, started_at__lt=cutoff)
        )

        count = 0
        for simulation in stalled:
            simulation.status = Simulation.Status.ERROR
            simulation.error_message = (
                "No progress detected for over "
                f"{constants.STALLED_RUN_TIMEOUT_REAL_MINUTES:.0f} minutes — "
                "the worker running this simulation appears to have died or "
                "stalled."
            )
            simulation.completed_at = timezone.now()
            simulation.save(
                update_fields=["status", "error_message", "completed_at"]
            )
            publish_simulation_status(simulation.id, simulation.status)
            count += 1

        self.stdout.write(f"Marked {count} stalled simulation(s) as Error.")
