from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from api.models import Simulation
from api.serializers.simulation_creation_dto import SimulationCreationDto
from api.serializers.simulation_detail_dto import SimulationDetailDto
from api.serializers.simulation_list_dto import SimulationListDto
from api.serializers.simulation_visualisation_dto import SimulationVisualisationDto
from api.tasks import run_simulation


class SimulationViewset(
    mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet
):
    queryset = Simulation.objects.all()
    filter_backends = [SearchFilter]
    search_fields = ["name"]

    def get_serializer_class(self):
        if self.action == "create":
            return SimulationCreationDto
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

    @action(detail=True, methods=["get"])
    def visualisation(self, request, pk=None):
        simulation = get_object_or_404(Simulation.objects.for_visualisation(), pk=pk)
        serializer = SimulationVisualisationDto(simulation)
        return Response(serializer.data)
