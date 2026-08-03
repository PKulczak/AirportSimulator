import csv

from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import CompareShareLink, Simulation, SimulationBatchShareLink
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


class SharedBatchResultsView(APIView):
    """GET /api/shared/batch/<token>/results/ — Slice A.2's read-only share
    link for a whole batch/sweep, the group counterpart to
    SharedSimulationDetailView. Same shape as SimulationViewset.batch's GET
    response; same AllowAny/no-account reasoning."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        share_link = get_object_or_404(
            SimulationBatchShareLink.objects.select_related("batch"), token=token
        )
        batch = share_link.batch
        simulations = Simulation.objects.with_detail_for_batch(batch.id)
        serializer = SimulationDetailDto(simulations, many=True)
        return Response(
            {
                "batch_id": batch.id,
                "swept_variable": batch.swept_variable,
                "simulations": serializer.data,
            }
        )


class SharedCompareView(APIView):
    """GET /api/shared/compare/<token>/ — Slice A.2's read-only share link for
    an ad-hoc comparison of several runs, the compare-view counterpart to
    SharedSimulationDetailView. Same shape as SimulationViewset.compare's
    response (a bare list); any linked id since deleted is silently skipped,
    same as the authenticated compare endpoint does for an unknown id."""

    permission_classes = [AllowAny]

    def get(self, request, token):
        share_link = get_object_or_404(CompareShareLink, token=token)
        # with_detail()'s aggregate annotations drop the model's default
        # ordering (see with_runway_count()'s docstring for the same Django
        # quirk) — reorder explicitly to match simulation_ids, mirroring
        # SimulationViewset.compare()'s own reordering step.
        simulations_by_id = {
            simulation.id: simulation
            for simulation in Simulation.objects.with_detail_for_ids(share_link.simulation_ids)
        }
        ordered = [
            simulations_by_id[id_]
            for id_ in share_link.simulation_ids
            if id_ in simulations_by_id
        ]
        serializer = SimulationDetailDto(ordered, many=True)
        return Response(serializer.data)
