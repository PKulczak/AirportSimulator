import csv

from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import Simulation
from api.serializers.aircraft_export_csv import Echo, aircraft_csv_rows
from api.serializers.simulation_detail_dto import SimulationDetailDto
from api.serializers.simulation_visualisation_dto import SimulationVisualisationDto


class SharedSimulationDetailView(APIView):
    """GET /api/shared/<token>/detail/ — Slice 10.1's read-only share link.

    Deliberately `AllowAny` and outside SimulationViewset's owner-scoped
    `get_queryset()`: the token itself (long, random, unguessable) is the
    credential, so this works for a signed-out visitor with no account at
    all, regardless of REQUIRE_AUTH. Exposes exactly the same shape as the
    authenticated detail endpoint — nothing about the token grants any
    write/other access, since no other view looks it up.
    """

    permission_classes = [AllowAny]

    def get(self, request, token):
        simulation = get_object_or_404(
            Simulation.objects.with_detail(), share_link__token=token
        )
        return Response(SimulationDetailDto(simulation).data)


class SharedSimulationVisualisationView(APIView):
    """GET /api/shared/<token>/visualisation/ — the replay-data counterpart
    to SharedSimulationDetailView; same token, same reasoning."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        simulation = get_object_or_404(
            Simulation.objects.for_visualisation(), share_link__token=token
        )
        return Response(SimulationVisualisationDto(simulation).data)


class SharedSimulationExportCsvView(APIView):
    """GET /api/shared/<token>/export.csv/ — the per-aircraft CSV export,
    reachable the same read-only, no-account way as detail/visualisation
    above (see SimulationViewset.export_csv for the owner-scoped original)."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        simulation = get_object_or_404(Simulation, share_link__token=token)
        writer = csv.writer(Echo())
        rows = (writer.writerow(row) for row in aircraft_csv_rows(simulation))
        response = StreamingHttpResponse(rows, content_type="text/csv")
        response["Content-Disposition"] = (
            f'attachment; filename="simulation-{simulation.id}-aircraft.csv"'
        )
        return response
