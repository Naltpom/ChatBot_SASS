"""Pages HTML servies par le serveur pour Chapote CM (routers/cm_mobile.py, routers/cm_invite_links.py), en anglais.

Langue d'une page : ``src.i18n.browser_lang`` (``?lang=`` ou Accept-Language du navigateur). ``{}`` = une valeur,
remplie par ``trf()`` (jamais traduite).
"""
EN = {
    # ---- Connexion de l'application (routers/cm_mobile.py)
    "Connexion": "Sign in",
    "Connexion…": "Signing in…",
    "Connectez-vous avec votre compte Chapote pour relier l'application.": "Sign in with your Chapote account to connect the app.",
    "Code de double authentification": "Two-factor authentication code",
    "Valider": "Confirm",
    "E-mail et mot de passe sur cm.chapote.fr": "Email and password on cm.chapote.fr",
    "Je suis connecté, continuer": "I'm signed in, continue",
    "Connecter l'application": "Connect the app",
    "Compte": "Account",
    "L'application Chapote CM pourra voir et gérer votre planning, vos comptes et vos commentaires, comme sur le site. Vous pourrez la déconnecter à tout moment.":
        "The Chapote CM app will be able to see and manage your schedule, accounts, and comments, just like on the website. You can disconnect it anytime.",
    "Autoriser": "Allow",
    "C'est fait": "All set",
    "Retour dans l'application… Si rien ne se passe, fermez cette page : l'application finit la connexion toute seule.":
        "Taking you back to the app… If nothing happens, close this page: the app will finish signing in on its own.",
    "Ouvrir l'application": "Open the app",
    "Lien expiré": "Link expired",
    "Revenez dans l'app Chapote CM et recommencez la connexion du compte.": "Go back to the Chapote CM app and connect the account again.",

    # ---- Lien d'invitation à un groupe (routers/cm_invite_links.py)
    "Invitation Chapote CM": "Chapote CM invite",
    "Ce lien d'invitation n'est plus valable. Demandez-en un nouveau à la personne qui vous l'a envoyé.":
        "This invite link is no longer valid. Ask the person who sent it for a new one.",
    "Rejoindre « {} »": "Join “{}”",
    "On vous invite à suivre ce groupe de comptes TikTok, YouTube et Instagram dans Chapote CM.":
        "You're invited to follow this group of TikTok, YouTube, and Instagram accounts in Chapote CM.",
    "Ouvrir dans l'app Chapote CM": "Open in the Chapote CM app",
    "L'app ne s'ouvre pas ?": "App not opening?",
    "Installez Chapote CM, connectez-vous, puis sur l'écran « Vos comptes » touchez « J'ai un lien d'invitation » et collez ce lien :":
        "Install Chapote CM and sign in. Then, on the “Your accounts” screen, paste this link under “Invite link”:",
}
