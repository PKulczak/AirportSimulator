from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from api.models import Simulation
from api.notifications import publish_simulation_status
from api.simulation import constants


class Command(BaseCommand):
    help = (
        "Marks any Simulation stuck in Running with no heartbeat update, or "
        "stuck in Pending long past the stale-run timeout, as Error — so a "
        "dead/stray worker doesn't leave it Running forever, and a task that "
        "was lost or errored before it could even reach Running (e.g. a "
        "transient DB blip right at pickup — see SimulationRunner.run) "
        "doesn't leave it Pending forever either. Intended to be run "
        "periodically (cron, a scheduled task, a looping sidecar process, "
        "etc.) — this command itself does not loop."
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
        stalled_running = Q(status=Simulation.Status.RUNNING) & (
            Q(last_heartbeat_at__lt=cutoff)
            | Q(last_heartbeat_at__isnull=True, started_at__lt=cutoff)
        )
        # A Pending row this old never even reached the Running transition —
        # there's no heartbeat to check yet (it's only ever set once
        # Running), so age since creation is the only signal available.
        stuck_pending = Q(status=Simulation.Status.PENDING, created_at__lt=cutoff)
        stalled = Simulation.objects.filter(stalled_running | stuck_pending)

        count = 0
        for simulation in stalled:
            was_pending = simulation.status == Simulation.Status.PENDING
            simulation.status = Simulation.Status.ERROR
            simulation.error_message = (
                "Still queued after over "
                f"{constants.STALLED_RUN_TIMEOUT_REAL_MINUTES:.0f} minutes — "
                "the task was lost, or the worker failed before it could "
                "start."
                if was_pending
                else (
                    "No progress detected for over "
                    f"{constants.STALLED_RUN_TIMEOUT_REAL_MINUTES:.0f} minutes"
                    " — the worker running this simulation appears to have "
                    "died or stalled."
                )
            )
            simulation.completed_at = timezone.now()
            simulation.save(
                update_fields=["status", "error_message", "completed_at"]
            )
            publish_simulation_status(simulation.id, simulation.status)
            count += 1

        self.stdout.write(f"Marked {count} stalled simulation(s) as Error.")
