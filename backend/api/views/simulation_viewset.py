import csv

from django.conf import settings
from django.db import transaction
from django.http import Http404, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from api.models import (
    CompareShareLink,
    Simulation,
    SimulationBatch,
    SimulationBatchShareLink,
    SimulationShareLink,
)
from api.notifications import publish_simulation_status
from api.serializers.aircraft_export_csv import Echo, aircraft_csv_rows
from api.serializers.compare_share_link_dto import CompareShareLinkDto
from api.serializers.simulation_batch_share_link_dto import SimulationBatchShareLinkDto
from api.serializers.simulation_config_dto import SimulationConfigDto
from api.serializers.simulation_creation_dto import SimulationCreationDto
from api.serializers.simulation_detail_dto import SimulationDetailDto
from api.serializers.simulation_list_dto import SimulationListDto
from api.serializers.simulation_rename_dto import SimulationRenameDto
from api.serializers.simulation_share_link_dto import SimulationShareLinkDto
from api.serializers.simulation_sweep_creation_dto import SimulationSweepCreationDto
from api.serializers.simulation_visualisation_dto import SimulationVisualisationDto
from api.tasks import run_simulation


class SimulationViewset(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Simulation.objects.all()
    filter_backends = [SearchFilter]
    search_fields = ["name"]
    # PATCH (rename) only — a run's config is immutable once created, so PUT
    # (full replace) is intentionally excluded (405).
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    # A comparison view is meant for a handful of runs side by side; without a
    # cap, `?ids=` accepts an arbitrarily long list and forces with_detail()'s
    # full aggregate/prefetch set to run against however many ids are given.
    MAX_COMPARE_IDS = 20

    def get_queryset(self):
        # Slice 9.2: scoped to the requesting user's own runs whenever
        # there's a real authenticated user (regardless of REQUIRE_AUTH) —
        # this applies uniformly to every action below, not just list/detail,
        # so a user can't reach another user's run by id via any other
        # action either. An anonymous request (REQUIRE_AUTH off, no
        # credentials) sees every run, matching pre-9.2 open-API behaviour —
        # there's no "owner" to scope by without a real caller. Staff accounts
        # (Django admin's `is_staff`) are exempt from the owner filter — an
        # admin needs to see every user's runs, not just their own.
        queryset = super().get_queryset()
        user = self.request.user
        if user.is_authenticated and not user.is_staff:
            queryset = queryset.filter(owner=user)
        if self.action == "list":
            return queryset.for_history()
        return queryset

    def _owner(self):
        return self.request.user if self.request.user.is_authenticated else None

    def _in_flight_cap_response(self, owner, additional_count):
        # Slice C.2 — anonymous requests have no owner to scope by (same
        # precedent as ownership scoping itself: there's nothing to cap
        # per-caller without a real authenticated user), so only an owned
        # request is checked at all.
        if owner is None:
            return None
        in_flight = Simulation.objects.filter(owner=owner).exclude(
            status__in=Simulation.TERMINAL_STATUSES
        ).count()
        cap = settings.MAX_IN_FLIGHT_SIMULATIONS_PER_USER
        if in_flight + additional_count > cap:
            return Response(
                {
                    "detail": (
                        f"You already have {in_flight} simulation(s) queued or running "
                        f"(max {cap} at once). Wait for one to finish before starting more."
                    )
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        return None

    def get_serializer_class(self):
        if self.action == "create":
            return SimulationCreationDto
        if self.action == "sweep":
            return SimulationSweepCreationDto
        if self.action in ("update", "partial_update"):
            return SimulationRenameDto
        return SimulationListDto

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner = self._owner()
        cap_response = self._in_flight_cap_response(owner, additional_count=1)
        if cap_response is not None:
            return cap_response
        simulation = serializer.save(owner=owner)

        run_simulation.send(simulation.id)

        output_serializer = SimulationListDto(simulation)
        headers = self.get_success_headers(output_serializer.data)
        return Response(
            output_serializer.data, status=status.HTTP_201_CREATED, headers=headers
        )

    @action(detail=True, methods=["get"], url_path="detail", url_name="detail")
    def simulation_detail(self, request, pk=None):
        simulation = get_object_or_404(self.get_queryset().with_detail(), pk=pk)
        serializer = SimulationDetailDto(simulation)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="sweep", url_name="sweep")
    def sweep(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner = self._owner()
        run_count = len(serializer.validated_data["_run_configs"])
        cap_response = self._in_flight_cap_response(owner, additional_count=run_count)
        if cap_response is not None:
            return cap_response
        simulations = serializer.save(owner=owner)

        for simulation in simulations:
            run_simulation.send(simulation.id)

        output_serializer = SimulationListDto(simulations, many=True)
        return Response(
            {"batch_id": simulations[0].batch_id, "simulations": output_serializer.data},
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get", "delete"], url_path="batch", url_name="batch")
    def batch(self, request):
        raw_id = request.query_params.get("id", "")
        if not raw_id.strip().isdigit():
            return Response(
                {"detail": "The 'id' query parameter (a batch id) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        batch_id = int(raw_id)
        # A batch has no owner field of its own — every run in it always
        # shares one owner (they're all created together in one
        # SimulationSweepCreationDto.create() call), so "the caller owns at
        # least one run in this batch" is equivalent to "the caller owns this
        # batch." Scoping the existence check through get_queryset() (rather
        # than fetching SimulationBatch directly) is what makes every action
        # below — including delete — 404 for a batch the caller doesn't own,
        # instead of letting an unscoped `batch.delete()` null out another
        # user's runs' batch_id/destroy their batch metadata.
        owned_runs = self.get_queryset().filter(batch_id=batch_id)
        if not owned_runs.exists():
            raise Http404
        batch = get_object_or_404(SimulationBatch, pk=batch_id)

        if request.method == "DELETE":
            # Deleting the SimulationBatch row alone would only null out its
            # runs' batch_id (the FK is SET_NULL, same "protect the data"
            # precedent as elsewhere) — a "delete this sweep" action means the
            # whole group of runs, not just ungrouping them, so the runs are
            # deleted explicitly first (cascading to their aircraft/events),
            # then the now-empty batch itself.
            with transaction.atomic():
                owned_runs.delete()
                batch.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        simulations = self.get_queryset().with_detail_for_batch(batch.id)
        serializer = SimulationDetailDto(simulations, many=True)
        return Response(
            {
                "batch_id": batch.id,
                "swept_variable": batch.swept_variable,
                "simulations": serializer.data,
            }
        )

    @action(detail=False, methods=["post"], url_path="batch/cancel", url_name="batch-cancel")
    def batch_cancel(self, request):
        raw_id = request.query_params.get("id", "")
        if not raw_id.strip().isdigit():
            return Response(
                {"detail": "The 'id' query parameter (a batch id) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        batch_id = int(raw_id)
        # Same ownership scoping as the `batch` action above — 404 rather than
        # letting a caller cancel a batch they don't own.
        owned_runs = self.get_queryset().filter(batch_id=batch_id)
        if not owned_runs.exists():
            raise Http404

        # Mirrors the single-run `cancel` action's conditional-UPDATE approach,
        # applied per status rather than a read-modify-write loop over every
        # run, so this can't race with SimulationRunner.run() flipping any one
        # run Pending -> Running concurrently: whichever write's WHERE clause
        # still matches at execution time wins, and neither can clobber the
        # other's status/completed_at.
        pending_ids = list(
            owned_runs.filter(status=Simulation.Status.PENDING).values_list("id", flat=True)
        )
        owned_runs.filter(id__in=pending_ids, status=Simulation.Status.PENDING).update(
            cancel_requested=True,
            status=Simulation.Status.CANCELLED,
            completed_at=timezone.now(),
        )
        # Already-Running runs: just set the flag; each run's own watchdog
        # reads it and stops (the web process never owns `status` directly).
        owned_runs.filter(status=Simulation.Status.RUNNING).update(cancel_requested=True)

        # Re-read every run that was Pending a moment ago to publish its actual
        # resulting status — usually Cancelled, but Running if it won the race
        # above (harmless to report either way; delivery is best-effort).
        if pending_ids:
            for simulation_id, new_status in Simulation.objects.filter(
                id__in=pending_ids
            ).values_list("id", "status"):
                publish_simulation_status(simulation_id, new_status)

        simulations = self.get_queryset().filter(batch_id=batch_id)
        serializer = SimulationListDto(simulations, many=True)
        return Response({"batch_id": batch_id, "simulations": serializer.data})

    @action(detail=False, methods=["post"], url_path="batch/share", url_name="batch-share")
    def batch_share(self, request):
        # Slice A.2 — the batch/sweep counterpart to `share()` below: a
        # shareable, unguessable token granting read-only access to a whole
        # sweep's results (see SharedBatchResultsView), same owner-scoping and
        # get_or_create-for-idempotency pattern as a single run's share link.
        raw_id = request.query_params.get("id", "")
        if not raw_id.strip().isdigit():
            return Response(
                {"detail": "The 'id' query parameter (a batch id) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        batch_id = int(raw_id)
        owned_runs = self.get_queryset().filter(batch_id=batch_id)
        if not owned_runs.exists():
            raise Http404
        batch = get_object_or_404(SimulationBatch, pk=batch_id)
        share_link, _ = SimulationBatchShareLink.objects.get_or_create(batch=batch)
        return Response(SimulationBatchShareLinkDto(share_link).data)

    @action(detail=False, methods=["get"], url_path="compare", url_name="compare")
    def compare(self, request):
        raw_ids = request.query_params.get("ids", "")
        parts = [part.strip() for part in raw_ids.split(",") if part.strip()]
        if not parts:
            return Response(
                {"detail": "The 'ids' query parameter is required, e.g. ?ids=1,2,3."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            # dict.fromkeys de-dupes while preserving the requested order.
            ids = list(dict.fromkeys(int(part) for part in parts))
        except ValueError:
            return Response(
                {
                    "detail": "The 'ids' query parameter must be a comma-separated list of integers."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(ids) > self.MAX_COMPARE_IDS:
            return Response(
                {
                    "detail": f"At most {self.MAX_COMPARE_IDS} ids may be compared at once "
                    f"({len(ids)} were given)."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        simulations_by_id = {
            simulation.id: simulation
            for simulation in self.get_queryset().with_detail_for_ids(ids)
        }
        # Silently drop any id that doesn't exist, same as filter(id__in=...)
        # would — the caller can tell which ids were found from the response.
        ordered = [simulations_by_id[id_] for id_ in ids if id_ in simulations_by_id]
        serializer = SimulationDetailDto(ordered, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="compare/share", url_name="compare-share")
    def compare_share(self, request):
        # Slice A.2 — the compare-view counterpart to `share()`/`batch_share()`
        # above. Unlike a run or a batch, a compare set isn't one durable
        # model, so the link is keyed on the caller's *owned* subset of the
        # requested ids, normalised (deduped + sorted) so repeat requests for
        # the same set of runs are idempotent regardless of selection order.
        raw_ids = request.query_params.get("ids", "")
        parts = [part.strip() for part in raw_ids.split(",") if part.strip()]
        if not parts:
            return Response(
                {"detail": "The 'ids' query parameter is required, e.g. ?ids=1,2,3."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            ids = list(dict.fromkeys(int(part) for part in parts))
        except ValueError:
            return Response(
                {
                    "detail": "The 'ids' query parameter must be a comma-separated list of integers."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(ids) > self.MAX_COMPARE_IDS:
            return Response(
                {
                    "detail": f"At most {self.MAX_COMPARE_IDS} ids may be compared at once "
                    f"({len(ids)} were given)."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        owned_ids = sorted(self.get_queryset().filter(id__in=ids).values_list("id", flat=True))
        if len(owned_ids) < 2:
            return Response(
                {"detail": "At least 2 valid runs are required to share a comparison."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        share_link, _ = CompareShareLink.objects.get_or_create(simulation_ids=owned_ids)
        return Response(CompareShareLinkDto(share_link).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        simulation = get_object_or_404(self.get_queryset(), pk=pk)
        if simulation.status in Simulation.TERMINAL_STATUSES:
            return Response(
                {"detail": f"Simulation is already {simulation.get_status_display()}."},
                status=status.HTTP_409_CONFLICT,
            )

        # A conditional UPDATE ... WHERE status='Pending' (not a plain
        # read-modify-write off the `simulation` object above) so this can't
        # race with SimulationRunner.run() concurrently flipping the same row
        # Pending -> Running: exactly one of the two writes actually matches
        # the WHERE clause, so neither can silently clobber the other's
        # status/completed_at. Works identically without needing
        # select_for_update() (and its backend-specific locking semantics).
        rows_matched = (
            self.get_queryset()
            .filter(pk=simulation.pk, status=Simulation.Status.PENDING)
            .update(
                cancel_requested=True,
                status=Simulation.Status.CANCELLED,
                completed_at=timezone.now(),
            )
        )
        if rows_matched:
            simulation.refresh_from_db()
            publish_simulation_status(simulation.id, simulation.status)
        else:
            # Already Running (or became so between the read above and the
            # update just now) — just set the flag; the runner's watchdog
            # reads it and stops.
            simulation.cancel_requested = True
            simulation.save(update_fields=["cancel_requested"])

        return Response(SimulationListDto(simulation).data)

    @action(detail=True, methods=["get"])
    def config(self, request, pk=None):
        simulation = get_object_or_404(
            self.get_queryset().prefetch_related("simulation_runways__closure_events"),
            pk=pk,
        )
        return Response(SimulationConfigDto(simulation).data)

    @action(detail=True, methods=["get"])
    def visualisation(self, request, pk=None):
        simulation = get_object_or_404(self.get_queryset().for_visualisation(), pk=pk)
        serializer = SimulationVisualisationDto(simulation)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def share(self, request, pk=None):
        # Owner-scoped via self.get_queryset() (same as every other action) —
        # only the run's owner (or staff) can mint/view its share link.
        # get_or_create rather than always creating fresh: repeated clicks on
        # the frontend's "Share" button return the same link instead of
        # invalidating a previously-copied one.
        simulation = get_object_or_404(self.get_queryset(), pk=pk)
        share_link, _ = SimulationShareLink.objects.get_or_create(simulation=simulation)
        return Response(SimulationShareLinkDto(share_link).data)

    @action(detail=True, methods=["get"], url_path="export.csv", url_name="export-csv")
    def export_csv(self, request, pk=None):
        simulation = get_object_or_404(self.get_queryset(), pk=pk)
        writer = csv.writer(Echo())
        rows = (writer.writerow(row) for row in aircraft_csv_rows(simulation))
        response = StreamingHttpResponse(rows, content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="simulation-{simulation.id}-aircraft.csv"'
        )
        return response
