import dramatiq
from django.contrib.auth.models import User
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.authtoken.models import Token

from api.models import Simulation, SimulationBatch
from tests.base_test import BaseFeatureTest


@override_settings(MAX_IN_FLIGHT_SIMULATIONS_PER_USER=3)
class SimulationInFlightCapTest(BaseFeatureTest):
    """Slice C.2 — caps how many Pending/Running runs one authenticated user
    can have queued at once (single-run + sweep creation combined), so
    nothing stops one user from queuing an unbounded *number* of otherwise
    legitimately-sized requests back to back."""

    def setUp(self):
        super().setUp()
        dramatiq.get_broker().flush_all()
        self.runways = self.create_runways(2)
        self.user = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.other_user = User.objects.create_user(username="bob", password="s3cur3-pass!")
        self.admin = User.objects.create_user(
            username="admin-staff", password="s3cur3-pass!", is_staff=True
        )
        self.token = Token.objects.create(user=self.user)
        self.other_token = Token.objects.create(user=self.other_user)
        self.admin_token = Token.objects.create(user=self.admin)

    def _as(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def _payload(self, **overrides):
        payload = {
            "name": "Morning rush",
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

    def _sweep_payload(self, **overrides):
        payload = self._payload(
            variable="arrivalRatePerHour", rangeEnd=40, rangeStep=10
        )
        payload.update(overrides)
        return payload


class SingleCreateCapTest(SimulationInFlightCapTest):
    def test_create_succeeds_right_up_to_the_cap(self):
        self.create_simulations(2, owner=self.user, status=Simulation.Status.PENDING)
        self._as(self.token)

        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)

    def test_create_429s_once_the_cap_is_reached(self):
        self.create_simulations(3, owner=self.user, status=Simulation.Status.PENDING)
        self._as(self.token)

        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn("detail", response.json())
        self.assertEqual(
            Simulation.objects.filter(owner=self.user, name="Morning rush").count(), 0
        )

    def test_running_runs_count_toward_the_cap_too(self):
        self.create_simulations(3, owner=self.user, status=Simulation.Status.RUNNING)
        self._as(self.token)

        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_terminal_runs_do_not_count_toward_the_cap(self):
        self.create_simulations(3, owner=self.user, status=Simulation.Status.COMPLETE)
        self.create_simulations(3, owner=self.user, status=Simulation.Status.ERROR)
        self.create_simulations(3, owner=self.user, status=Simulation.Status.CANCELLED)
        self._as(self.token)

        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)

    def test_cap_is_scoped_per_user(self):
        self.create_simulations(3, owner=self.other_user, status=Simulation.Status.PENDING)
        self._as(self.token)

        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)

    def test_staff_is_also_subject_to_the_cap(self):
        self.create_simulations(3, owner=self.admin, status=Simulation.Status.PENDING)
        self._as(self.admin_token)

        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_anonymous_requests_are_exempt_from_the_cap(self):
        self.create_simulations(10, status=Simulation.Status.PENDING)

        response = self.client.post(
            reverse("simulation-list"), self._payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)


class SweepCreateCapTest(SimulationInFlightCapTest):
    def test_sweep_succeeds_right_up_to_the_cap(self):
        # rangeEnd=40, rangeStep=10 from a start of 20 produces exactly 3 runs.
        self._as(self.token)

        response = self.client.post(
            reverse("simulation-sweep"), self._sweep_payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(len(response.json()["simulations"]), 3)

    def test_sweep_429s_and_creates_nothing_when_it_would_exceed_the_cap(self):
        self.create_simulations(1, owner=self.user, status=Simulation.Status.PENDING)
        self._as(self.token)

        response = self.client.post(
            reverse("simulation-sweep"), self._sweep_payload(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn("detail", response.json())
        self.assertEqual(SimulationBatch.objects.count(), 0)
        self.assertEqual(
            Simulation.objects.filter(owner=self.user, batch__isnull=False).count(), 0
        )
