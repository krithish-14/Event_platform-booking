(function initVolunteerInvite() {

	"use strict";



	const params = new URLSearchParams(window.location.search);

	const token = (params.get("token") || "").trim();

	if (token) {

		window.location.replace(`volunteer-portal.html?token=${encodeURIComponent(token)}`);

		return;

	}



	const V = window.JodVolunteer;

	const card = document.getElementById("inviteCard");

	if (!V || !card) return;



	card.innerHTML = `

		<div class="vol-kicker">Volunteer Invitation</div>

		<h1 class="vol-title">Invitation not found</h1>

		<p class="vol-sub">This link is missing a valid invitation token.</p>

	`;

})();


