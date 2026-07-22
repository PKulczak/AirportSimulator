from django.db import models


class SimulationRunway(models.Model):
    class OperationalStatus(models.TextChoices):
        AVAILABLE = "Available", "Available"
        RUNWAY_INSPECTION = "RunwayInspection", "Runway Inspection"
        SNOW_CLEARANCE = "SnowClearance", "Snow Clearance"
        EQUIPMENT_FAILURE = "EquipmentFailure", "Equipment Failure"

    class OperatingMode(models.TextChoices):
        ARRIVALS_ONLY = "ArrivalsOnly", "Arrivals Only"
        DEPARTURES_ONLY = "DeparturesOnly", "Departures Only"
        MIXED = "Mixed", "Mixed"

    simulation = models.ForeignKey(
        "api.Simulation", on_delete=models.CASCADE, related_name="simulation_runways"
    )
    runway = models.ForeignKey(
        "api.Runway", on_delete=models.PROTECT, related_name="simulation_runways"
    )
    operational_status = models.CharField(
        max_length=16,
        choices=OperationalStatus.choices,
        default=OperationalStatus.AVAILABLE,
    )
    operating_mode = models.CharField(max_length=16, choices=OperatingMode.choices)

    class Meta:
        unique_together = (("simulation", "runway"),)

    def accepts(self, movement_type):
        """Whether this runway (in its configured mode) accepts the given Aircraft movement type."""
        if self.operating_mode == self.OperatingMode.MIXED:
            return True
        if self.operating_mode == self.OperatingMode.ARRIVALS_ONLY:
            return movement_type == "Arrival"
        if self.operating_mode == self.OperatingMode.DEPARTURES_ONLY:
            return movement_type == "Departure"
        return False

    def __str__(self):
        return f"{self.runway.identifier} ({self.operating_mode}) for {self.simulation_id}"
