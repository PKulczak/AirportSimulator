import re
from unittest import mock

from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.throttling import ScopedRateThrottle

from tests.base_test import BaseFeatureTest

RESET_LINK_PATTERN = re.compile(r"/reset-password/([^/\s]+)/([^/\s]+)/")


class PasswordResetRequestTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username="pilot", email="pilot@example.com", password="s3cur3-pass!"
        )

    def test_request_for_a_known_email_sends_a_reset_link(self):
        response = self.client.post(
            reverse("auth-password-reset"), {"email": "pilot@example.com"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("pilot@example.com", mail.outbox[0].to)
        match = RESET_LINK_PATTERN.search(mail.outbox[0].body)
        self.assertIsNotNone(match)

    def test_request_for_an_unknown_email_still_204s_but_sends_nothing(self):
        response = self.client.post(
            reverse("auth-password-reset"), {"email": "nobody@example.com"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(len(mail.outbox), 0)

    def test_request_rejects_an_invalid_email(self):
        response = self.client.post(
            reverse("auth-password-reset"), {"email": "not-an-email"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_request_for_an_inactive_users_email_sends_nothing(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])

        response = self.client.post(
            reverse("auth-password-reset"), {"email": "pilot@example.com"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(len(mail.outbox), 0)

    def test_request_is_reachable_even_when_require_auth_is_on(self):
        with override_settings(REQUIRE_AUTH=True):
            response = self.client.post(
                reverse("auth-password-reset"), {"email": "pilot@example.com"}, format="json"
            )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)


class PasswordResetConfirmTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username="pilot", email="pilot@example.com", password="s3cur3-pass!"
        )
        self.old_token = Token.objects.create(user=self.user)

    def _request_reset_link(self):
        self.client.post(
            reverse("auth-password-reset"), {"email": "pilot@example.com"}, format="json"
        )
        match = RESET_LINK_PATTERN.search(mail.outbox[-1].body)
        return match.group(1), match.group(2)

    def _confirm(self, uid, token, **overrides):
        payload = {
            "uid": uid,
            "token": token,
            "password": "n3w-correct-horse-battery",
            "passwordConfirm": "n3w-correct-horse-battery",
        }
        payload.update(overrides)
        return self.client.post(reverse("auth-password-reset-confirm"), payload, format="json")

    def test_confirm_with_a_valid_link_changes_the_password_and_logs_in(self):
        uid, token = self._request_reset_link()

        response = self._confirm(uid, token)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        body = response.json()
        self.assertIn("token", body)
        self.assertEqual(body["user"]["username"], "pilot")

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("n3w-correct-horse-battery"))

    def test_confirm_revokes_the_old_auth_token(self):
        uid, token = self._request_reset_link()
        self._confirm(uid, token)

        self.assertFalse(Token.objects.filter(key=self.old_token.key).exists())

    def test_confirm_rejects_a_garbled_uid(self):
        _, token = self._request_reset_link()

        response = self._confirm("not-a-real-uid", token)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("s3cur3-pass!"))

    def test_confirm_rejects_an_invalid_token(self):
        uid = urlsafe_base64_encode(force_bytes(self.user.pk))

        response = self._confirm(uid, "not-a-real-token")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_rejects_reusing_a_token_after_the_password_already_changed(self):
        uid, token = self._request_reset_link()
        first = self._confirm(uid, token)
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        second = self._confirm(uid, token, password="yet-another-pass1", passwordConfirm="yet-another-pass1")

        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_rejects_mismatched_password_confirmation(self):
        uid, token = self._request_reset_link()

        response = self._confirm(uid, token, passwordConfirm="something-else-entirely")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("passwordConfirm", response.json())

    def test_confirm_rejects_a_weak_new_password(self):
        uid, token = self._request_reset_link()

        response = self._confirm(uid, token, password="password", passwordConfirm="password")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("password", response.json())

    def test_confirm_rejects_an_inactive_user(self):
        uid, token = self._request_reset_link()
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])

        response = self._confirm(uid, token)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_is_reachable_even_when_require_auth_is_on(self):
        uid, token = self._request_reset_link()

        with override_settings(REQUIRE_AUTH=True):
            response = self._confirm(uid, token)

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class PasswordResetThrottleTest(BaseFeatureTest):
    def setUp(self):
        super().setUp()
        User.objects.create_user(
            username="pilot", email="pilot@example.com", password="s3cur3-pass!"
        )
        cache.clear()

    def tearDown(self):
        cache.clear()
        super().tearDown()

    def test_reset_request_is_throttled_after_the_configured_rate(self):
        with mock.patch.object(
            ScopedRateThrottle, "THROTTLE_RATES", {"password_reset": "1/min"}
        ):
            first = self.client.post(
                reverse("auth-password-reset"), {"email": "pilot@example.com"}, format="json"
            )
            self.assertEqual(first.status_code, status.HTTP_204_NO_CONTENT)

            second = self.client.post(
                reverse("auth-password-reset"), {"email": "pilot@example.com"}, format="json"
            )
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
