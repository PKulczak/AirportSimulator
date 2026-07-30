import csv
import io

from rest_framework import status

from api.models import Aircraft, Simulation
from tests.base_test import BaseFeatureTest


def _export_url(simulation_id):
    # Trailing slash, matching every other action route in this API
    # (/detail/, /config/, /visualisation/, /cancel/) — DRF's router appends
    # one by default and a request without it 301s to the slashed form.
    return f"/api/simulations/{simulation_id}/export.csv/"


def _rows(response):
    content = b"".join(response.streaming_content).decode("utf-8")
    return list(csv.reader(io.StringIO(content)))


class SimulationExportCsvTest(BaseFeatureTest):
    def test_export_header_row_and_one_line_per_aircraft(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)
        runway = self.create_runways(1)[0]
        self.create_aircraft(
            simulation=simulation,
            runway=runway,
            callsign="BAW123",
            movement_type=Aircraft.MovementType.ARRIVAL,
            outcome=Aircraft.Outcome.SUCCESS,
            wait_minutes=4.5,
            initial_fuel_minutes=35.0,
        )
        self.create_aircraft(
            simulation=simulation,
            callsign="EZY456",
            movement_type=Aircraft.MovementType.DEPARTURE,
            outcome=Aircraft.Outcome.CANCELLED,
            wait_minutes=None,
            initial_fuel_minutes=20.0,
        )

        response = self.client.get(_export_url(simulation.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = _rows(response)
        self.assertEqual(
            rows[0], ["Callsign", "Movement", "Outcome", "Wait (mins)", "Fuel (mins)", "Runway"]
        )
        self.assertEqual(len(rows), 3)  # header + 2 aircraft
        self.assertEqual(
            rows[1], ["BAW123", "Arrival", "Success", "4.50", "35.00", runway.identifier]
        )
        self.assertEqual(rows[2], ["EZY456", "Departure", "Cancelled", "", "20.00", ""])

    def test_export_zero_aircraft_returns_header_only(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)

        response = self.client.get(_export_url(simulation.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = _rows(response)
        self.assertEqual(len(rows), 1)

    def test_export_content_type_and_disposition(self):
        simulation = self.create_simulations(1, status=Simulation.Status.COMPLETE)

        response = self.client.get(_export_url(simulation.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/csv")
        self.assertIn(
            f'simulation-{simulation.id}-aircraft.csv', response["Content-Disposition"]
        )

    def test_export_404_for_unknown_simulation(self):
        response = self.client.get(_export_url(999999))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_export_available_regardless_of_simulation_status(self):
        # Aircraft rows exist as soon as a run starts, before it necessarily
        # completes — export shouldn't be gated on status.
        simulation = self.create_simulations(1, status=Simulation.Status.RUNNING)
        self.create_aircraft(simulation=simulation, outcome=Aircraft.Outcome.PENDING)

        response = self.client.get(_export_url(simulation.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rows = _rows(response)
        self.assertEqual(len(rows), 2)
