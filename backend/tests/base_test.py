from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    Aircraft,
    AircraftEvent,
    Runway,
    Simulation,
    SimulationRunway,
    SimulationRunwayEvent,
)


class BaseFeatureTest(TestCase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def create_runways(self, count=2, **overrides):
        runways = []
        for i in range(count):
            defaults = {
                "identifier": f"RW{i}",
                "heading_degrees": 90,
                "length_metres": 3000,
                "is_active": True,
            }
            defaults.update(overrides)
            if count > 1 and "identifier" not in overrides:
                defaults["identifier"] = f"RW{i}"
            runways.append(Runway.objects.create(**defaults))
        return runways

    def create_simulations(self, count=1, **overrides):
        simulations = []
        for i in range(count):
            defaults = {
                "name": f"Simulation {i}",
                "status": Simulation.Status.PENDING,
                "arrival_rate_per_hour": 10,
                "departure_rate_per_hour": 10,
                "duration_minutes": 60,
                "max_wait_minutes": 15,
                "aircraft_speed_knots": 140,
                "include_closures": False,
            }
            defaults.update(overrides)
            simulations.append(Simulation.objects.create(**defaults))
        return simulations if count > 1 else simulations[0]

    def create_simulation_runway(self, simulation=None, runway=None, **overrides):
        if simulation is None:
            simulation = self.create_simulations()
        if runway is None:
            runway = self.create_runways(1)[0]
        defaults = {
            "simulation": simulation,
            "runway": runway,
            "operational_status": SimulationRunway.OperationalStatus.OPEN,
            "operating_mode": SimulationRunway.OperatingMode.MIXED,
        }
        defaults.update(overrides)
        return SimulationRunway.objects.create(**defaults)

    def create_aircraft(self, simulation=None, **overrides):
        if simulation is None:
            simulation = self.create_simulations()
        defaults = {
            "simulation": simulation,
            "callsign": "TST123",
            "operator": "Test Airways",
            "origin_destination": "LHR",
            "movement_type": Aircraft.MovementType.ARRIVAL,
            "initial_fuel_minutes": 120,
            "scheduled_time": timezone.now(),
            "outcome": Aircraft.Outcome.PENDING,
        }
        defaults.update(overrides)
        return Aircraft.objects.create(**defaults)

    def create_aircraft_event(self, aircraft=None, **overrides):
        if aircraft is None:
            aircraft = self.create_aircraft()
        defaults = {
            "aircraft": aircraft,
            "event_type": AircraftEvent.EventType.LOW_FUEL,
            "occurred_at": timezone.now(),
            "priority_boost": 1,
        }
        defaults.update(overrides)
        return AircraftEvent.objects.create(**defaults)

    def create_runway_event(self, simulation_runway=None, **overrides):
        if simulation_runway is None:
            simulation_runway = self.create_simulation_runway()
        defaults = {
            "simulation_runway": simulation_runway,
            "event_type": SimulationRunwayEvent.EventType.CLOSED,
            "occurred_at": timezone.now(),
            "reason": "Test closure",
        }
        defaults.update(overrides)
        return SimulationRunwayEvent.objects.create(**defaults)
