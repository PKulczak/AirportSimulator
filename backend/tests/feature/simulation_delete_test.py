from rest_framework import status

from api.models import (
    Aircraft,
    AircraftEvent,
    Runway,
    Simulation,
    SimulationRunway,
    SimulationRunwayEvent,
)
from tests.base_test import BaseFeatureTest


def _delete_url(simulation_id):
    # NB: reverse("simulation-detail") collides with the custom metrics action
    # (both are named "simulation-detail"), so it resolves to /{pk}/detail/, not
    # the destroy route. Hit the destroy path directly.
    return f"/api/simulations/{simulation_id}/"


class SimulationDeleteTest(BaseFeatureTest):
    def test_delete_returns_204_and_removes_simulation(self):
        simulation = self.create_simulations(1)
        response = self.client.delete(_delete_url(simulation.id))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Simulation.objects.filter(id=simulation.id).exists())

    def test_delete_cascades_to_aircraft_events_and_runways(self):
        simulation = self.create_simulations(1)
        runway = self.create_runways(1)[0]
        sr = self.create_simulation_runway(simulation=simulation, runway=runway)
        aircraft = self.create_aircraft(simulation=simulation)
        self.create_aircraft_event(aircraft=aircraft)
        self.create_runway_event(simulation_runway=sr)

        response = self.client.delete(_delete_url(simulation.id))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Aircraft.objects.filter(simulation=simulation).exists())
        self.assertFalse(AircraftEvent.objects.filter(aircraft=aircraft).exists())
        self.assertFalse(
            SimulationRunway.objects.filter(simulation=simulation).exists()
        )
        self.assertFalse(
            SimulationRunwayEvent.objects.filter(simulation_runway=sr).exists()
        )

    def test_delete_leaves_the_master_runway_intact(self):
        # SimulationRunway -> Runway is PROTECT, but deleting the Simulation
        # removes the join row first, so the master Runway must survive.
        simulation = self.create_simulations(1)
        runway = self.create_runways(1)[0]
        self.create_simulation_runway(simulation=simulation, runway=runway)

        response = self.client.delete(_delete_url(simulation.id))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(Runway.objects.filter(id=runway.id).exists())

    def test_delete_only_removes_the_target_simulation(self):
        keep, remove = self.create_simulations(2)
        response = self.client.delete(_delete_url(remove.id))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(Simulation.objects.filter(id=keep.id).exists())
        self.assertFalse(Simulation.objects.filter(id=remove.id).exists())

    def test_delete_unknown_simulation_returns_404(self):
        response = self.client.delete(_delete_url(999999))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
