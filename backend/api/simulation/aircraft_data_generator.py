from datetime import timedelta

import numpy as np
from faker_airtravel.constants import airlines

from api.models import Aircraft
from api.simulation import constants

_AIRPORT_CODES_CACHE = None


def _curated_airport_codes():
    """A curated list of real, scheduled-service IATA codes sourced from the
    `airports-py` dataset (large/medium airports only, to keep generated
    origin/destination codes recognisable)."""
    global _AIRPORT_CODES_CACHE
    if _AIRPORT_CODES_CACHE is not None:
        return _AIRPORT_CODES_CACHE

    from airports.airport_data import airports as all_airports

    codes = [
        airport["iata"]
        for airport in all_airports
        if airport.get("iata")
        and airport.get("scheduled_service") == "TRUE"
        and airport.get("type") in ("large_airport", "medium_airport")
    ]
    _AIRPORT_CODES_CACHE = codes or ["LHR", "JFK", "CDG", "DXB", "SIN"]
    return _AIRPORT_CODES_CACHE


class AircraftDataGenerator:
    """Generates all Aircraft rows for a Simulation up front (before the SimPy
    clock starts), using a Poisson process per movement type.

    `base_time` anchors offset-minute-into-the-run values onto real
    `scheduled_time` datetimes; the SimulationRunner recovers the offset later
    via `(aircraft.scheduled_time - base_time).total_seconds() / 60`, so the
    generator and the runner must agree on the same `base_time`.

    Operator names are drawn from `faker_airtravel`'s curated airline list,
    but via our own seeded `numpy` Generator rather than the package's own
    `airline()` helper — that helper calls the stdlib `random` module
    directly instead of Faker's seedable generator, so it ignores
    `Faker.seed_instance()` entirely and would silently break the
    `random_seed`-driven determinism this generator promises.
    """

    def __init__(self, simulation, base_time):
        self.simulation = simulation
        self.base_time = base_time
        self.rng = np.random.default_rng(simulation.random_seed)

    def generate(self):
        """Returns a list of unsaved `Aircraft` instances, sorted by
        `scheduled_time`."""
        aircraft = []
        aircraft += self._generate_for_movement(
            Aircraft.MovementType.ARRIVAL, self.simulation.arrival_rate_per_hour
        )
        aircraft += self._generate_for_movement(
            Aircraft.MovementType.DEPARTURE, self.simulation.departure_rate_per_hour
        )
        aircraft.sort(key=lambda a: a.scheduled_time)
        return aircraft

    def _generate_for_movement(self, movement_type, rate_per_hour):
        if not rate_per_hour or rate_per_hour <= 0:
            return []

        duration_minutes = self.simulation.duration_minutes
        mean_interarrival_minutes = 60.0 / rate_per_hour

        generated = []
        offset = 0.0
        while True:
            gap = self.rng.exponential(scale=mean_interarrival_minutes)
            offset += gap
            if offset > duration_minutes:
                break
            generated.append(self._build_aircraft(movement_type, offset))
        return generated

    def _build_aircraft(self, movement_type, offset_minutes):
        codes = _curated_airport_codes()
        origin_destination = codes[self.rng.integers(0, len(codes))]

        operator = airlines[self.rng.integers(0, len(airlines))]
        callsign = self._generate_callsign(operator)

        fuel = self.rng.normal(
            constants.INITIAL_FUEL_MINUTES_MEAN, constants.INITIAL_FUEL_MINUTES_STD
        )
        initial_fuel_minutes = max(constants.INITIAL_FUEL_MINUTES_MIN, float(fuel))

        scheduled_time = self.base_time + timedelta(minutes=offset_minutes)

        return Aircraft(
            simulation=self.simulation,
            callsign=callsign,
            operator=operator,
            origin_destination=origin_destination,
            movement_type=movement_type,
            initial_fuel_minutes=initial_fuel_minutes,
            scheduled_time=scheduled_time,
            outcome=Aircraft.Outcome.PENDING,
        )

    def _generate_callsign(self, operator):
        alpha_words = [
            "".join(ch for ch in word if ch.isalpha()) for word in operator.split()
        ]
        prefix = "".join(word[0] for word in alpha_words if word)[:3].upper()
        if not prefix:
            prefix = "AIR"
        number = self.rng.integers(100, 9999)
        return f"{prefix}{number}"
