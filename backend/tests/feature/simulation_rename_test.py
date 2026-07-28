from rest_framework import status

from api.models import Simulation
from tests.base_test import BaseFeatureTest


def _url(simulation_id):
    # reverse("simulation-detail") collides with the metrics action, so hit the
    # detail/update path directly (see simulation_delete_test).
    return f"/api/simulations/{simulation_id}/"


class SimulationRenameTest(BaseFeatureTest):
    def test_patch_updates_name(self):
        simulation = self.create_simulations(1, name="Old name")
        response = self.client.patch(
            _url(simulation.id), {"name": "New name"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["name"], "New name")
        simulation.refresh_from_db()
        self.assertEqual(simulation.name, "New name")

    def test_patch_trims_whitespace(self):
        simulation = self.create_simulations(1, name="Old name")
        response = self.client.patch(
            _url(simulation.id), {"name": "  Trimmed  "}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        simulation.refresh_from_db()
        self.assertEqual(simulation.name, "Trimmed")

    def test_patch_rejects_invalid_characters(self):
        simulation = self.create_simulations(1, name="Good name")
        response = self.client.patch(
            _url(simulation.id), {"name": "Bad \U0001F600 emoji"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.json())
        simulation.refresh_from_db()
        self.assertEqual(simulation.name, "Good name")

    def test_patch_rejects_blank_name(self):
        simulation = self.create_simulations(1, name="Good name")
        response = self.client.patch(
            _url(simulation.id), {"name": "   "}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.json())
        simulation.refresh_from_db()
        self.assertEqual(simulation.name, "Good name")

    def test_patch_allows_basic_punctuation(self):
        simulation = self.create_simulations(1)
        response = self.client.patch(
            _url(simulation.id), {"name": "LHR Run #3 (v2), take-two"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        simulation.refresh_from_db()
        self.assertEqual(simulation.name, "LHR Run #3 (v2), take-two")

    def test_patch_does_not_change_other_config_fields(self):
        simulation = self.create_simulations(
            1,
            name="Original",
            arrival_rate_per_hour=20,
            duration_minutes=120,
        )
        response = self.client.patch(
            _url(simulation.id),
            {
                "name": "Renamed",
                # These must be ignored — config is immutable after create.
                "arrivalRatePerHour": 99,
                "durationMinutes": 999,
                "status": "Complete",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        simulation.refresh_from_db()
        self.assertEqual(simulation.name, "Renamed")
        self.assertEqual(simulation.arrival_rate_per_hour, 20)
        self.assertEqual(simulation.duration_minutes, 120)
        self.assertEqual(simulation.status, Simulation.Status.PENDING)

    def test_put_is_not_allowed(self):
        simulation = self.create_simulations(1)
        response = self.client.put(
            _url(simulation.id), {"name": "Whatever"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_patch_unknown_simulation_returns_404(self):
        response = self.client.patch(_url(999999), {"name": "X"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
