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
    clock starts).

    Aircraft are scheduled at evenly-spaced target times (`60 / rate_per_hour`
    minutes apart, per movement type) — this target is persisted verbatim as
    `Aircraft.scheduled_time`, i.e. "the scheduled arrival/departure time".
    The time an aircraft actually enters the model is that target jittered by
    `Normal(0, TARGET_TIME_JITTER_STD_MINUTES)`, representing the real-world
    weather/delay variability the brief describes — this "actual" offset is
    *not* persisted on Aircraft; it's only used by `SimulationRunner` to
    decide when to fire the aircraft's SimPy process. Keeping the two
    separate (rather than persisting only the jittered value) means a future
    "delay between scheduled and actual arrival time" metric can simply
    compare `scheduled_time` against `completion_time`, with no schema
    change needed.

    `generate()` therefore returns `(Aircraft, actual_offset_minutes)` pairs,
    not bare `Aircraft` instances.

    `base_time` anchors offset-minute-into-the-run values onto real
    datetimes; the generator and the runner must agree on the same
    `base_time`.

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
        """Returns a list of `(Aircraft, actual_offset_minutes)` pairs,
        sorted by `scheduled_time`. `Aircraft` instances are unsaved."""
        entries = []
        entries += self._generate_for_movement(
            Aircraft.MovementType.ARRIVAL, self.simulation.arrival_rate_per_hour
        )
        entries += self._generate_for_movement(
            Aircraft.MovementType.DEPARTURE, self.simulation.departure_rate_per_hour
        )
        entries.sort(key=lambda entry: entry[0].scheduled_time)
        return entries

    def _generate_for_movement(self, movement_type, rate_per_hour):
        if not rate_per_hour or rate_per_hour <= 0:
            return []

        duration_minutes = self.simulation.duration_minutes
        interval_minutes = 60.0 / rate_per_hour

        generated = []
        target_offset = interval_minutes
        while target_offset <= duration_minutes:
            jitter = self.rng.normal(0.0, constants.TARGET_TIME_JITTER_STD_MINUTES)
            actual_offset = max(0.0, target_offset + jitter)
            generated.append(
                self._build_aircraft(movement_type, target_offset, actual_offset)
            )
            target_offset += interval_minutes
        return generated

    def _build_aircraft(self, movement_type, target_offset_minutes, actual_offset_minutes):
        codes = _curated_airport_codes()
        origin_destination = codes[self.rng.integers(0, len(codes))]

        operator = airlines[self.rng.integers(0, len(airlines))]
        callsign = self._generate_callsign(operator)

        fuel = self.rng.normal(
            constants.INITIAL_FUEL_MINUTES_MEAN, constants.INITIAL_FUEL_MINUTES_STD
        )
        initial_fuel_minutes = max(constants.INITIAL_FUEL_MINUTES_MIN, float(fuel))

        scheduled_time = self.base_time + timedelta(minutes=target_offset_minutes)

        aircraft = Aircraft(
            simulation=self.simulation,
            callsign=callsign,
            operator=operator,
            origin_destination=origin_destination,
            movement_type=movement_type,
            initial_fuel_minutes=initial_fuel_minutes,
            scheduled_time=scheduled_time,
            outcome=Aircraft.Outcome.PENDING,
        )
        return aircraft, actual_offset_minutes

    def _generate_callsign(self, operator):
        alpha_words = [
            "".join(ch for ch in word if ch.isalpha()) for word in operator.split()
        ]
        prefix = "".join(word[0] for word in alpha_words if word)[:3].upper()
        if not prefix:
            prefix = "AIR"
        number = self.rng.integers(100, 9999)
        return f"{prefix}{number}"
