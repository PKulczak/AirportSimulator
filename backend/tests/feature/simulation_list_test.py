from django.urls import reverse
from rest_framework import status

from api.models import Simulation
from tests.base_test import BaseFeatureTest


class SimulationListTest(BaseFeatureTest):
    def test_list_returns_paginated_results(self):
        self.create_simulations(15)

        response = self.client.get(reverse("simulation-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertIn("count", body)
        self.assertIn("next", body)
        self.assertIn("previous", body)
        self.assertIn("results", body)
        self.assertEqual(body["count"], 15)
        self.assertEqual(len(body["results"]), 10)  # PAGE_SIZE = 10

    def test_list_second_page(self):
        self.create_simulations(15)

        response = self.client.get(reverse("simulation-list"), {"page": 2})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(len(body["results"]), 5)

    def test_list_search_by_name(self):
        self.create_simulations(1, name="Alpha Run")
        self.create_simulations(1, name="Beta Run")

        response = self.client.get(reverse("simulation-list"), {"search": "Alpha"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["name"], "Alpha Run")

    def test_list_item_shape_is_camel_case(self):
        self.create_simulations(1, name="Shape Check")

        response = self.client.get(reverse("simulation-list"))

        body = response.json()
        item = body["results"][0]
        for key in [
            "id",
            "name",
            "status",
            "arrivalRatePerHour",
            "departureRatePerHour",
            "durationMinutes",
            "maxWaitMinutes",
            "aircraftSpeedKnots",
            "includeClosures",
            "createdAt",
            "completedAt",
        ]:
            self.assertIn(key, item)

    def test_list_ordering_newest_first(self):
        first = self.create_simulations(1, name="First")
        second = self.create_simulations(1, name="Second")

        response = self.client.get(reverse("simulation-list"))

        body = response.json()
        ids = [item["id"] for item in body["results"]]
        self.assertEqual(ids[0], second.id)
        self.assertEqual(ids[1], first.id)
