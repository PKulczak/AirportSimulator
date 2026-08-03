"""CSV shaping for GET /api/simulations/{id}/export.csv — not a DRF
serializer (no JSON/camelCase involved), but lives alongside the other
"shape a Simulation's data for a response" modules per that convention.
"""

CSV_HEADER = ["Callsign", "Movement", "Outcome", "Wait (mins)", "Fuel (mins)", "Runway"]


class Echo:
    """A pseudo file-like object whose `write` just returns what it's given,
    so `csv.writer` can be driven row-by-row without buffering the whole
    file in memory — the standard Django pattern for streaming a CSV
    (docs.djangoproject.com/en/stable/howto/outputting-csv/). Shared by both
    SimulationViewset.export_csv and SharedSimulationExportCsvView."""

    def write(self, value):
        return value


def aircraft_csv_rows(simulation):
    """Yields the header row, then one row per aircraft (scheduled-time
    order, the model's own default ordering) — a generator so the view can
    stream rows to the client instead of building the whole file in memory.
    """
    yield CSV_HEADER
    for aircraft in simulation.aircraft.select_related("runway").all():
        yield [
            aircraft.callsign,
            aircraft.movement_type,
            aircraft.outcome,
            "" if aircraft.wait_minutes is None else f"{aircraft.wait_minutes:.2f}",
            f"{aircraft.initial_fuel_minutes:.2f}",
            aircraft.runway.identifier if aircraft.runway_id else "",
        ]
