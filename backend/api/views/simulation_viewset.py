import csv

from django.db import transaction
from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from api.models import Simulation, SimulationBatch, SimulationShareLink
from api.notifications import publish_simulation_status
from api.serializers.aircraft_export_csv import Echo, aircraft_csv_rows
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
        simulation = serializer.save(owner=self._owner())

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
        simulations = serializer.save(owner=self._owner())

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
        batch = get_object_or_404(SimulationBatch, pk=int(raw_id))

        if request.method == "DELETE":
            # Deleting the SimulationBatch row alone would only null out its
            # runs' batch_id (the FK is SET_NULL, same "protect the data"
            # precedent as elsewhere) — a "delete this sweep" action means the
            # whole group of runs, not just ungrouping them, so the runs are
            # deleted explicitly first (cascading to their aircraft/events),
            # then the now-empty batch itself.
            with transaction.atomic():
                self.get_queryset().filter(batch_id=batch.id).delete()
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

        simulations_by_id = {
            simulation.id: simulation
            for simulation in self.get_queryset().with_detail_for_ids(ids)
        }
        # Silently drop any id that doesn't exist, same as filter(id__in=...)
        # would — the caller can tell which ids were found from the response.
        ordered = [simulations_by_id[id_] for id_ in ids if id_ in simulations_by_id]
        serializer = SimulationDetailDto(ordered, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        simulation = get_object_or_404(self.get_queryset(), pk=pk)
        if simulation.status in Simulation.TERMINAL_STATUSES:
            return Response(
                {"detail": f"Simulation is already {simulation.get_status_display()}."},
                status=status.HTTP_409_CONFLICT,
            )

        simulation.cancel_requested = True
        if simulation.status == Simulation.Status.PENDING:
            # Not running yet — cancel outright. If a worker still picks it up,
            # SimulationRunner.run() skips an already-terminal run.
            simulation.status = Simulation.Status.CANCELLED
            simulation.completed_at = timezone.now()
            simulation.save(
                update_fields=["cancel_requested", "status", "completed_at"]
            )
            publish_simulation_status(simulation.id, simulation.status)
        else:  # Running — the runner's watchdog reads the flag and stops.
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
