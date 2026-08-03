import csv
import io

from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework import status
from rest_framework.authtoken.models import Token

from api.models import Aircraft, Simulation, SimulationShareLink
from tests.base_test import BaseFeatureTest


def _share_url(simulation_id):
    return f"/api/simulations/{simulation_id}/share/"


def _shared_detail_url(token):
    return f"/api/shared/{token}/detail/"


def _shared_visualisation_url(token):
    return f"/api/shared/{token}/visualisation/"


def _shared_export_csv_url(token):
    return f"/api/shared/{token}/export.csv/"


def _rows(response):
    content = b"".join(response.streaming_content).decode("utf-8")
    return list(csv.reader(io.StringIO(content)))


class SimulationShareCreationTest(BaseFeatureTest):
    """Slice 10.1 — creating/minting a share link is an owner-scoped action,
    same as every other action on SimulationViewset (see Slice 9.2)."""

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.other = User.objects.create_user(username="bob", password="s3cur3-pass!")
        self.owner_token = Token.objects.create(user=self.owner)
        self.other_token = Token.objects.create(user=self.other)
        self.simulation = self.create_simulations(
            1, name="Shareable run", owner=self.owner, status=Simulation.Status.COMPLETE
        )

    def _as(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_share_creates_a_token_and_persists_a_share_link(self):
        self._as(self.owner_token)
        response = self.client.post(_share_url(self.simulation.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertIn("token", body)
        self.assertTrue(
            SimulationShareLink.objects.filter(
                simulation=self.simulation, token=body["token"]
            ).exists()
        )

    def test_share_is_idempotent_and_returns_the_same_token_on_repeat_calls(self):
        self._as(self.owner_token)
        first = self.client.post(_share_url(self.simulation.id)).json()["token"]
        second = self.client.post(_share_url(self.simulation.id)).json()["token"]

        self.assertEqual(first, second)
        self.assertEqual(
            SimulationShareLink.objects.filter(simulation=self.simulation).count(), 1
        )

    def test_share_404s_for_another_users_simulation(self):
        self._as(self.other_token)
        response = self.client.post(_share_url(self.simulation.id))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(
            SimulationShareLink.objects.filter(simulation=self.simulation).exists()
        )

    def test_share_401s_without_credentials_once_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.post(_share_url(self.simulation.id))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_share_works_anonymously_when_require_auth_is_off(self):
        # Matches Slice 9.2's pre-existing "no owner" behaviour for the rest
        # of the API when the API is fully open — not a new hole introduced
        # by sharing.
        unowned = self.create_simulations(1, name="Unowned run")
        response = self.client.post(_share_url(unowned.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)


class SharedSimulationAccessTest(BaseFeatureTest):
    """The read-only consumption side: a token grants access to detail,
    visualisation, and the CSV export with *no* credentials at all, regardless
    of REQUIRE_AUTH — that's the whole point of a share link."""

    def setUp(self):
        super().setUp()
        self.owner = User.objects.create_user(username="alice", password="s3cur3-pass!")
        self.simulation = self.create_simulations(
            1,
            name="Shared run",
            owner=self.owner,
            status=Simulation.Status.COMPLETE,
        )
        self.share_link = SimulationShareLink.objects.create(simulation=self.simulation)

    def test_shared_detail_returns_200_with_no_credentials(self):
        response = self.client.get(_shared_detail_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["name"], "Shared run")

    def test_shared_detail_works_even_when_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(_shared_detail_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_shared_detail_404s_for_an_unknown_token(self):
        response = self.client.get(_shared_detail_url("not-a-real-token"))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_shared_visualisation_returns_200_with_no_credentials(self):
        response = self.client.get(_shared_visualisation_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["name"], "Shared run")

    def test_shared_visualisation_works_even_when_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(_shared_visualisation_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_shared_visualisation_404s_for_an_unknown_token(self):
        response = self.client.get(_shared_visualisation_url("not-a-real-token"))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_token_only_exposes_its_own_simulation_not_others(self):
        other_owner_run = self.create_simulations(
            1,
            name="A different run",
            owner=self.owner,
            status=Simulation.Status.COMPLETE,
        )
        other_share_link = SimulationShareLink.objects.create(simulation=other_owner_run)

        response = self.client.get(_shared_detail_url(self.share_link.token))
        self.assertEqual(response.json()["name"], "Shared run")

        other_response = self.client.get(_shared_detail_url(other_share_link.token))
        self.assertEqual(other_response.json()["name"], "A different run")

    def test_a_valid_share_token_does_not_grant_access_to_the_owner_scoped_endpoints(self):
        # The token is only honoured by the two dedicated /shared/ routes —
        # it isn't a backdoor credential for the normal, owner-scoped API.
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(f"/api/simulations/{self.simulation.id}/detail/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_shared_detail_404s_once_the_simulation_is_deleted(self):
        self.simulation.delete()
        response = self.client.get(_shared_detail_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(SimulationShareLink.objects.filter(id=self.share_link.id).exists())

    def test_shared_export_csv_returns_200_with_no_credentials(self):
        self.create_aircraft(
            simulation=self.simulation,
            callsign="BAW123",
            movement_type=Aircraft.MovementType.ARRIVAL,
            outcome=Aircraft.Outcome.SUCCESS,
            wait_minutes=4.5,
            initial_fuel_minutes=35.0,
        )

        response = self.client.get(_shared_export_csv_url(self.share_link.token))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/csv")
        self.assertIn(
            f"simulation-{self.simulation.id}-aircraft.csv", response["Content-Disposition"]
        )
        rows = _rows(response)
        self.assertEqual(len(rows), 2)  # header + 1 aircraft
        self.assertEqual(rows[1][0], "BAW123")

    def test_shared_export_csv_works_even_when_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.get(_shared_export_csv_url(self.share_link.token))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_shared_export_csv_404s_for_an_unknown_token(self):
        response = self.client.get(_shared_export_csv_url("not-a-real-token"))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
