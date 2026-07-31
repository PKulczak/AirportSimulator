from django.urls import reverse
from rest_framework import status

from api.models import Template, TemplateRunway
from tests.base_test import BaseFeatureTest


class TemplateTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        self.runways = self.create_runways(2)

    def _payload(self, **overrides):
        payload = {
            "name": "Peak Summer Storm",
            "arrivalRatePerHour": 20,
            "departureRatePerHour": 15,
            "durationMinutes": 120,
            "maxWaitMinutes": 20,
            "includeClosures": False,
            "runways": [
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": self.runways[1].id, "operatingMode": "Mixed"},
            ],
        }
        payload.update(overrides)
        return payload

    # -- create -----------------------------------------------------------

    def test_create_template_returns_201_and_camel_case_body(self):
        response = self.client.post(
            reverse("template-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        body = response.json()
        self.assertIn("id", body)
        self.assertEqual(body["name"], "Peak Summer Storm")
        self.assertEqual(body["arrivalRatePerHour"], 20)
        self.assertEqual(body["departureRatePerHour"], 15)
        self.assertEqual(len(body["runways"]), 2)
        self.assertIn("createdAt", body)

    def test_create_template_persists_runways(self):
        response = self.client.post(
            reverse("template-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        template = Template.objects.get(id=response.json()["id"])
        self.assertEqual(TemplateRunway.objects.filter(template=template).count(), 2)

    def test_create_template_defaults_aircraft_speed_from_settings(self):
        from django.conf import settings

        response = self.client.post(
            reverse("template-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.json()["aircraftSpeedKnots"], settings.AIRCRAFT_SPEED_IN_KNOTS
        )

    def test_create_template_defaults_random_seed_and_weight_mix_to_null(self):
        response = self.client.post(
            reverse("template-list"), self._payload(), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        template = Template.objects.get(id=response.json()["id"])
        self.assertIsNone(template.random_seed)
        self.assertIsNone(template.heavy_percentage)
        self.assertIsNone(template.medium_percentage)
        self.assertIsNone(template.light_percentage)
        self.assertEqual(template.weather_condition, "Clear")

    def test_create_template_accepts_and_persists_seed_weight_mix_and_weather(self):
        payload = self._payload(
            randomSeed=555,
            heavyPercentage=20,
            mediumPercentage=60,
            lightPercentage=20,
            weatherCondition="Snow",
        )
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        template = Template.objects.get(id=response.json()["id"])
        self.assertEqual(template.random_seed, 555)
        self.assertEqual(template.heavy_percentage, 20)
        self.assertEqual(template.medium_percentage, 60)
        self.assertEqual(template.light_percentage, 20)
        self.assertEqual(template.weather_condition, "Snow")

    def test_create_template_rejects_name_with_invalid_characters(self):
        payload = self._payload(name="Bad \U0001F600 emoji template")
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.json())

    def test_create_template_requires_at_least_one_runway(self):
        response = self.client.post(
            reverse("template-list"), self._payload(runways=[]), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_template_rejects_duplicate_runway_ids(self):
        payload = self._payload(
            runways=[
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
                {"runwayId": self.runways[0].id, "operatingMode": "Mixed"},
            ]
        )
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_template_rejects_unknown_runway_id(self):
        payload = self._payload(runways=[{"runwayId": 999999, "operatingMode": "Mixed"}])
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_template_rejects_more_than_ten_runways(self):
        from api.models import Runway

        runways = [
            Runway.objects.create(
                identifier=f"TPL{i}", heading_degrees=90, length_metres=3000, is_active=True
            )
            for i in range(11)
        ]
        payload = self._payload(
            runways=[{"runwayId": r.id, "operatingMode": "Mixed"} for r in runways]
        )
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("runways", response.json())

    def test_create_template_rejects_zero_arrival_and_departure_rate(self):
        payload = self._payload(arrivalRatePerHour=0, departureRatePerHour=0)
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_template_rejects_partial_weight_class_mix(self):
        payload = self._payload(heavyPercentage=20)
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_template_rejects_weight_class_mix_not_summing_to_100(self):
        payload = self._payload(heavyPercentage=20, mediumPercentage=60, lightPercentage=10)
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_template_rejects_max_wait_over_90_percent_of_duration(self):
        payload = self._payload(durationMinutes=100, maxWaitMinutes=91)
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_template_rejects_single_runway_with_closures_enabled(self):
        payload = self._payload(
            includeClosures=True,
            runways=[{"runwayId": self.runways[0].id, "operatingMode": "Mixed"}],
        )
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_template_rejects_an_unknown_weather_condition(self):
        payload = self._payload(weatherCondition="Hurricane")
        response = self.client.post(reverse("template-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("weatherCondition", response.json())

    # -- list / retrieve ----------------------------------------------------

    def test_list_templates_returns_saved_templates_newest_first(self):
        self.client.post(reverse("template-list"), self._payload(name="Older"), format="json")
        self.client.post(reverse("template-list"), self._payload(name="Newer"), format="json")

        response = self.client.get(reverse("template-list"))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.json()["results"]
        self.assertEqual([r["name"] for r in results], ["Newer", "Older"])
        self.assertEqual(len(results[0]["runways"]), 2)

    def test_list_templates_search_filters_by_name(self):
        self.client.post(reverse("template-list"), self._payload(name="Rush Hour"), format="json")
        self.client.post(reverse("template-list"), self._payload(name="Quiet Night"), format="json")

        response = self.client.get(reverse("template-list"), {"search": "Rush"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.json()["results"]
        self.assertEqual([r["name"] for r in results], ["Rush Hour"])

    def test_retrieve_template_returns_full_config(self):
        created = self.client.post(
            reverse("template-list"), self._payload(), format="json"
        ).json()

        response = self.client.get(reverse("template-detail", kwargs={"pk": created["id"]}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["name"], "Peak Summer Storm")

    def test_retrieve_template_404_for_unknown_id(self):
        response = self.client.get(reverse("template-detail", kwargs={"pk": 999999}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    # -- delete -------------------------------------------------------------

    def test_delete_template_removes_it_and_its_runways(self):
        created = self.client.post(
            reverse("template-list"), self._payload(), format="json"
        ).json()
        template_id = created["id"]

        response = self.client.delete(
            reverse("template-detail", kwargs={"pk": template_id})
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Template.objects.filter(id=template_id).exists())
        self.assertEqual(TemplateRunway.objects.filter(template_id=template_id).count(), 0)

    def test_delete_template_404_for_unknown_id(self):
        response = self.client.delete(reverse("template-detail", kwargs={"pk": 999999}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
