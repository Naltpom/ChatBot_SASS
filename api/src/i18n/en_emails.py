"""E-mails envoyés aux personnes (compte Chapote, équipes, reprise de compte cm), en anglais.

Clé = texte français exact du code (services/email_service.py, routers/cm_account_requests.py) ; ``{}`` = une valeur,
dans l'ordre du français, remplie par ``trf()`` (valeurs jamais traduites). Les e-mails internes à l'équipe Chapote
(avis, contact, réclamations au support) restent en français.
"""
EN = {
    # ---- Commun (en-tête, pied de page, signature)
    "Bonjour {},": "Hi {},",
    "— L'équipe Chapote": "— The Chapote team",
    "Une question ?": "Questions?",

    # ---- Thèmes (libellé de catégorie et bouton)
    "BIENVENUE": "WELCOME",
    "ÉQUIPE": "TEAM",
    "FACTURATION": "BILLING",
    "SÉCURITÉ": "SECURITY",
    "ACTION REQUISE": "ACTION REQUIRED",
    "Ouvrir le lien": "Open link",
    "Créer mon chatbot": "Create my chatbot",
    "Rejoindre l'équipe": "Join the team",
    "Confirmer mon email": "Confirm my email",
    "Ouvrir le tableau de bord": "Open dashboard",
    "Ajuster mon plafond": "Adjust my cap",
    "Choisir un nouveau mot de passe": "Choose a new password",
    "Sécuriser mon compte": "Secure my account",
    "Ouvrir mon tableau de bord": "Open my dashboard",

    # ---- Vérification de l'adresse
    "Confirmez votre adresse email": "Confirm your email address",
    "Merci d'avoir créé votre compte Chapote. Confirmez votre adresse email en ouvrant le lien ci-dessous :":
        "Thanks for creating your Chapote account. Confirm your email address with the link below:",
    "Ce lien est valable 48 heures. Si vous n'êtes pas à l'origine de cette inscription, vous pouvez ignorer ce message.":
        "This link is valid for 48 hours. If you didn't sign up, you can ignore this email.",

    # ---- Mot de passe oublié
    "Réinitialisation de votre mot de passe": "Reset your password",
    "Vous avez demandé à réinitialiser le mot de passe de votre compte Chapote. Choisissez un nouveau mot de passe via le lien ci-dessous :":
        "You asked to reset the password for your Chapote account. Choose a new password with the link below:",
    "Ce lien est valable 1 heure et ne fonctionne qu'une seule fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste inchangé.":
        "This link is valid for 1 hour and works only once. If you didn't ask for this, ignore this email: your current password stays the same.",

    # ---- Bienvenue
    "Bienvenue chez Chapote": "Welcome to Chapote",
    "Votre adresse email est confirmée : bienvenue chez Chapote !": "Your email address is confirmed. Welcome to Chapote!",
    "Vous pouvez dès maintenant créer votre premier chatbot et le mettre en ligne en quelques minutes :":
        "You can now create your first chatbot and put it online in minutes:",
    "Une question ? Écrivez-nous, nous sommes là pour vous aider.": "Questions? Write to us, we're here to help.",

    # ---- Invitation / ajout dans une équipe
    "Vous êtes invité·e à rejoindre {} sur Chapote": "You're invited to join {} on Chapote",
    "Vous êtes invité·e à rejoindre l'équipe « {} » sur Chapote en tant que {}.":
        "You're invited to join the “{}” team on Chapote as {}.",
    "Pour accepter, créez votre compte avec cette même adresse email — vous rejoindrez automatiquement l'équipe :":
        "To accept, create your account with this same email address. You'll join the team automatically:",
    "Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce message.":
        "If you weren't expecting this invite, you can ignore this email.",
    "Vous avez été ajouté·e à {}": "You've been added to {}",
    "Vous avez été ajouté·e à l'équipe « {} » sur Chapote en tant que {}.":
        "You've been added to the “{}” team on Chapote as {}.",
    "Retrouvez l'équipe et ses chatbots depuis votre tableau de bord :": "Find the team and its chatbots in your dashboard:",

    # ---- Mot de passe modifié
    "Votre mot de passe a été modifié": "Your password was changed",
    "Le mot de passe de votre compte Chapote vient d'être modifié.": "The password for your Chapote account was just changed.",
    "Si vous êtes à l'origine de ce changement, aucune action n'est requise.": "If you made this change, you don't need to do anything.",
    "Dans le cas contraire, réinitialisez immédiatement votre mot de passe et contactez le support :":
        "If you didn't, reset your password right away and contact support:",

    # ---- Chapote CM : reprise d'un compte (routers/cm_account_requests.py)
    "Demande de reprise du compte {}": "Request to take over {}",
    "{} demande à reprendre le compte {} « {} », relié à votre espace Chapote CM.":
        "{} is asking to take over the {} account “{}”, which is linked to your Chapote CM space.",
    "Cette personne vient de se connecter au compte chez {}.": "They just signed in to this account on {}.",
    "Son message : « {} »": "Their message: “{}”",
    "Acceptez ou refusez dans Chapote CM, onglet Comptes (sous 7 jours) :":
        "Accept or decline in Chapote CM, in the Accounts tab (within 7 days):",
    "Sans réponse, ou en cas de refus, elle pourra s'adresser au support de Chapote, qui tranchera.":
        "If you don't answer, or if you decline, they can contact Chapote support, who will decide.",
    "Compte {} : demande acceptée": "{}: request accepted",
    "Votre demande a été acceptée : le compte {} « {} » est maintenant dans votre espace Chapote CM, avec ses publications à venir.":
        "Your request was accepted: the {} account “{}” is now in your Chapote CM space, with its scheduled posts.",
    "Compte {} : demande refusée": "{}: request declined",
    "L'espace qui gère le compte {} « {} » a refusé votre demande de reprise.":
        "The space that manages the {} account “{}” declined your takeover request.",
    "Si ce compte vous appartient, vous pouvez faire une réclamation au support depuis Chapote CM (Comptes).":
        "If this account is yours, you can file a claim with support from Chapote CM (Accounts).",
}
