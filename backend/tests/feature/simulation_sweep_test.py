import dramatiq
from django.urls import reverse
from rest_framework import status

from api.models import Simulation
from tests.base_test import BaseFeatureTest


class SimulationSweepTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        dramatiq.get_broker().flush_all()
        self.runways = self.create_runways(2)

    def _payload(self, **overrides):
        payload = {
            "name": "Arrival sweep",
            "arrivalRatePerHour": 10,
            "departureRatePerHour": 10,
            "durationMinutes": 120,
            "maxWaitMinutes": 20,
            "includeClosures": False,
            "runways": [
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ],
            "variable": "arrivalRatePerHour",
            "rangeEnd": 30,
            "rangeStep": 10,
        }
        payload.update(overrides)
        return payload

    def test_sweep_creates_n_simulations_with_variable_stepped(self):
        response = self.client.post(
            reverse("simulation-sweep"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        self.assertEqual(len(body["simulations"]), 3)
        rates = sorted(
            Simulation.objects.filter(id__in=[s["id"] for s in body["simulations"]])
            .values_list("arrival_rate_per_hour", flat=True)
        )
        self.assertEqual(rates, [10, 20, 30])

    def test_sweep_groups_created_simulations_into_one_batch(self):
        response = self.client.post(
            reverse("simulation-sweep"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        simulations = Simulation.objects.filter(
            id__in=[s["id"] for s in body["simulations"]]
        )
        batch_ids = {simulation.batch_id for simulation in simulations}
        self.assertEqual(len(batch_ids), 1)
        self.assertNotIn(None, batch_ids)
        self.assertEqual(body["batchId"], batch_ids.pop())

    def test_sweep_enqueues_every_created_simulation(self):
        broker = dramatiq.get_broker()
        response = self.client.post(
            reverse("simulation-sweep"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertGreaterEqual(broker.queues["default"].qsize(), 3)

    def test_sweep_rejects_range_producing_fewer_than_two_runs(self):
        payload = self._payload(rangeEnd=10, rangeStep=10)  # start == end
        response = self.client.post(reverse("simulation-sweep"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sweep_rejects_range_end_before_start(self):
        payload = self._payload(rangeEnd=5)
        response = self.client.post(reverse("simulation-sweep"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("rangeEnd", response.json())

    def test_sweep_rejects_range_exceeding_max_runs(self):
        payload = self._payload(arrivalRatePerHour=0, rangeEnd=100, rangeStep=1)
        response = self.client.post(reverse("simulation-sweep"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sweep_rejects_unknown_variable(self):
        payload = self._payload(variable="notARealField")
        response = self.client.post(reverse("simulation-sweep"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("variable", response.json())

    def test_sweep_is_atomic_when_a_later_step_violates_a_business_rule(self):
        # All runways ArrivalsOnly; sweeping departureRatePerHour from 0 to 20
        # eventually needs a departures-accepting runway that doesn't exist —
        # the whole sweep should fail, not partially create simulations.
        before = Simulation.objects.count()
        payload = self._payload(
            departureRatePerHour=0,
            variable="departureRatePerHour",
            rangeEnd=20,
            rangeStep=10,
            runways=[
                {"runwayId": self.runways[0].id, "operatingMode": "ArrivalsOnly"},
                {"runwayId": self.runways[1].id, "operatingMode": "ArrivalsOnly"},
            ],
        )
        response = self.client.post(reverse("simulation-sweep"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Simulation.objects.count(), before)

    def test_sweep_rejects_name_with_invalid_characters(self):
        payload = self._payload(name="Bad \U0001F600 emoji sweep")
        response = self.client.post(reverse("simulation-sweep"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sweep_applies_the_same_seed_to_every_generated_run(self):
        response = self.client.post(
            reverse("simulation-sweep"), self._payload(randomSeed=777), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        seeds = set(
            Simulation.objects.filter(
                id__in=[s["id"] for s in body["simulations"]]
            ).values_list("random_seed", flat=True)
        )
        self.assertEqual(seeds, {777})

    def test_sweep_leaves_seed_independently_random_when_omitted(self):
        response = self.client.post(
            reverse("simulation-sweep"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        seeds = set(
            Simulation.objects.filter(
                id__in=[s["id"] for s in body["simulations"]]
            ).values_list("random_seed", flat=True)
        )
        self.assertEqual(seeds, {None})

    def test_sweep_applies_the_same_weight_class_mix_to_every_generated_run(self):
        response = self.client.post(
            reverse("simulation-sweep"),
            self._payload(heavyPercentage=20, mediumPercentage=60, lightPercentage=20),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        body = response.json()
        mixes = {
            (s.heavy_percentage, s.medium_percentage, s.light_percentage)
            for s in Simulation.objects.filter(
                id__in=[s["id"] for s in body["simulations"]]
            )
        }
        self.assertEqual(mixes, {(20, 60, 20)})

    def test_sweep_applies_the_same_weather_condition_to_every_generated_run(self):
        response = self.client.post(
            reverse("simulation-sweep"),
            self._payload(weatherCondition="Windy"),
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        body = response.json()
        conditions = {
            s.weather_condition
            for s in Simulation.objects.filter(
                id__in=[s["id"] for s in body["simulations"]]
            )
        }
        self.assertEqual(conditions, {"Windy"})

    def test_sweep_rejects_a_weight_class_mix_not_summing_to_100(self):
        payload = self._payload(
            heavyPercentage=20, mediumPercentage=60, lightPercentage=30
        )
        response = self.client.post(reverse("simulation-sweep"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_sweep_can_step_duration_minutes(self):
        payload = self._payload(
            variable="durationMinutes",
            durationMinutes=60,
            rangeEnd=180,
            rangeStep=60,
            maxWaitMinutes=10,
        )
        response = self.client.post(reverse("simulation-sweep"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        durations = sorted(
            Simulation.objects.filter(
                id__in=[s["id"] for s in body["simulations"]]
            ).values_list("duration_minutes", flat=True)
        )
        self.assertEqual(durations, [60, 120, 180])
