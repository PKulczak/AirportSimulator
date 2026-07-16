from django.contrib import admin

from api.models import (
    Aircraft,
    AircraftEvent,
    Runway,
    Simulation,
    SimulationRunway,
    SimulationRunwayEvent,
)

admin.site.register(Simulation)
admin.site.register(Runway)
admin.site.register(SimulationRunway)
admin.site.register(Aircraft)
admin.site.register(AircraftEvent)
admin.site.register(SimulationRunwayEvent)
