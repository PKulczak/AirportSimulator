from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from api.models import Simulation
from api.notifications import publish_simulation_status
from api.serializers.simulation_config_dto import SimulationConfigDto
from api.serializers.simulation_creation_dto import SimulationCreationDto
from api.serializers.simulation_detail_dto import SimulationDetailDto
from api.serializers.simulation_list_dto import SimulationListDto
from api.serializers.simulation_rename_dto import SimulationRenameDto
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
        if self.action == "list":
            return Simulation.objects.with_runway_count()
        return super().get_queryset()

    def get_serializer_class(self):
        if self.action == "create":
            return SimulationCreationDto
        if self.action in ("update", "partial_update"):
            return SimulationRenameDto
        return SimulationListDto

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        simulation = serializer.save()

        run_simulation.send(simulation.id)

        output_serializer = SimulationListDto(simulation)
        headers = self.get_success_headers(output_serializer.data)
        return Response(
            output_serializer.data, status=status.HTTP_201_CREATED, headers=headers
        )

    @action(detail=True, methods=["get"], url_path="detail", url_name="detail")
    def simulation_detail(self, request, pk=None):
        simulation = get_object_or_404(Simulation.objects.with_detail(), pk=pk)
        serializer = SimulationDetailDto(simulation)
        return Response(serializer.data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        simulation = get_object_or_404(Simulation, pk=pk)
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
            Simulation.objects.prefetch_related("simulation_runways__closure_events"),
            pk=pk,
        )
        return Response(SimulationConfigDto(simulation).data)

    @action(detail=True, methods=["get"])
    def visualisation(self, request, pk=None):
        simulation = get_object_or_404(Simulation.objects.for_visualisation(), pk=pk)
        serializer = SimulationVisualisationDto(simulation)
        return Response(serializer.data)
