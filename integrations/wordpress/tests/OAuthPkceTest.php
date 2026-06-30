<?php
/**
 * Frontiere de securite : flux OAuth Authorization Code + PKCE/S256.
 *
 * Deux pivots couverts :
 *  - DERIVATION PKCE (Chapote_BO_API) : base64url sans padding (RFC 7636 §A),
 *    code_challenge = base64url(sha256(verifier)), longueur du verifier dans la
 *    borne 43..128, et state/verifier conserves COTE SERVEUR (transient), jamais
 *    dans l'URL autrement que le state public.
 *  - ANTI-CSRF (Chapote_BO_REST::connect_callback) : le state retourne est
 *    compare en strict au state stocke ; toute divergence => 400 + purge du PKCE
 *    (one-time), AVANT tout echange de code.
 */

use PHPUnit\Framework\TestCase;

final class OAuthPkceTest extends TestCase {

    protected function setUp(): void {
        wpt_reset();
    }

    /* -------------------- base64url (RFC 7636 §A) -------------------- */

    public function test_b64url_known_vector(): void {
        // RFC 4648 : octets {14 fb 9c 03 d9 7e} => base64url "FPucA9l-".
        $bin = "\x14\xfb\x9c\x03\xd9\x7e";
        $this->assertSame('FPucA9l-', Chapote_BO_API::b64url($bin));
    }

    public function test_b64url_is_url_safe_and_unpadded(): void {
        // 97 octets => 97 % 3 == 1 => le base64 standard PORTE du padding '=' :
        // on exerce reellement le strip de padding (96 % 3 == 0 ne l'aurait pas fait).
        $out = Chapote_BO_API::b64url(random_bytes(97));
        $this->assertStringNotContainsString('+', $out);
        $this->assertStringNotContainsString('/', $out);
        $this->assertStringNotContainsString('=', $out);
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+$/', $out);
    }

    /**
     * Vecteurs DETERMINISTES dont le base64 standard contient a la fois du padding
     * ET des caracteres non url-safe (+,/), pour prouver le strip ET la substitution
     * RFC 7636 §A. base64("\xfb")="+w==" (+ et ==), base64("\xff\xff")="//8=" (// et =).
     */
    public function test_b64url_strips_padding_and_replaces_unsafe_chars(): void {
        $this->assertSame('-w', Chapote_BO_API::b64url("\xfb"));      // +w== -> -w
        $this->assertSame('__8', Chapote_BO_API::b64url("\xff\xff")); // //8= -> __8
        foreach (array("\xfb", "\xff\xff") as $bin) {
            $out = Chapote_BO_API::b64url($bin);
            $this->assertStringNotContainsString('=', $out);
            $this->assertStringNotContainsString('+', $out);
            $this->assertStringNotContainsString('/', $out);
        }
    }

    /* -------------------- build_authorize_url (S256 + state) -------------------- */

    /** Extrait les parametres de requete de l'URL d'autorisation construite. */
    private function buildAndParse(): array {
        $url   = Chapote_BO_API::build_authorize_url();
        $query = parse_url($url, PHP_URL_QUERY);
        $args  = array();
        parse_str((string) $query, $args);
        return array($url, $args);
    }

    public function test_authorize_url_carries_required_oauth_params(): void {
        [$url, $args] = $this->buildAndParse();

        $this->assertStringStartsWith('https://chapote.fr/authorize?', $url);
        $this->assertSame('code', $args['response_type']);
        $this->assertSame('S256', $args['code_challenge_method']);
        $this->assertSame('chapote_wp', $args['client_id']);
        $this->assertSame('plugin', $args['scope']);
        $this->assertSame('https://example.test/wp-admin/admin.php?page=chapote-chatbot', $args['redirect_uri']);
        $this->assertNotEmpty($args['state']);
        $this->assertNotEmpty($args['code_challenge']);
    }

    public function test_state_and_verifier_are_kept_server_side(): void {
        [, $args] = $this->buildAndParse();

        $pending = Chapote_BO_API::pkce_pending();
        $this->assertIsArray($pending);
        // Le state public DOIT correspondre au state stocke cote serveur.
        $this->assertSame($pending['state'], $args['state']);
        // Le verifier (secret) NE DOIT PAS fuiter dans l'URL.
        $this->assertStringNotContainsString($pending['verifier'], $args['state']);
        $this->assertArrayNotHasKey('code_verifier', $args);
    }

    public function test_code_challenge_is_s256_of_stored_verifier(): void {
        [, $args] = $this->buildAndParse();
        $verifier = Chapote_BO_API::pkce_pending()['verifier'];

        // RFC 7636 : code_challenge = base64url( SHA256( code_verifier ) ).
        $expected = Chapote_BO_API::b64url(hash('sha256', $verifier, true));
        $this->assertSame($expected, $args['code_challenge']);
    }

    public function test_code_verifier_length_within_rfc_bounds(): void {
        $this->buildAndParse();
        $verifier = Chapote_BO_API::pkce_pending()['verifier'];
        $len = strlen($verifier);
        // RFC 7636 §4.1 : 43 <= longueur <= 128.
        $this->assertGreaterThanOrEqual(43, $len);
        $this->assertLessThanOrEqual(128, $len);
    }

    public function test_clear_pkce_pending_removes_it(): void {
        $this->buildAndParse();
        $this->assertNotNull(Chapote_BO_API::pkce_pending());
        Chapote_BO_API::clear_pkce_pending();
        $this->assertNull(Chapote_BO_API::pkce_pending());
    }

    /* -------------------- connect_callback (anti-CSRF state) -------------------- */

    private function callbackRequest(string $code, string $state): Fake_REST_Request {
        return (new Fake_REST_Request())
            ->set_param('code', $code)
            ->set_param('state', $state);
    }

    public function test_callback_rejects_empty_code_or_state(): void {
        $res = Chapote_BO_REST::connect_callback($this->callbackRequest('', 'some-state'));
        $this->assertInstanceOf(WP_REST_Response::class, $res);
        $this->assertSame(400, $res->get_status());
        $this->assertSame('invalid_request', $res->get_data()['error']);
        // Aucun echange de code ne doit etre tente sur une requete malformee.
        $this->assertSame(0, $GLOBALS['_wpt']['remote_calls']);
    }

    public function test_callback_rejects_when_no_pending_authorization(): void {
        // Aucun build_authorize_url prealable => aucun PKCE en attente.
        $res = Chapote_BO_REST::connect_callback($this->callbackRequest('the-code', 'the-state'));
        $this->assertSame(400, $res->get_status());
        $this->assertSame('no_pending_authorization', $res->get_data()['error']);
        // Sans PKCE en attente, on ne contacte jamais le serveur d'autorisation.
        $this->assertSame(0, $GLOBALS['_wpt']['remote_calls']);
    }

    /**
     * Coeur anti-CSRF : un state qui ne matche pas celui stocke est REJETE (400
     * state_mismatch), le PKCE est PURGE (one-time) ET AUCUN echange de code n'est
     * tente. L'espion wp_remote_request (remote_calls) prouve qu'on n'envoie pas le
     * code de l'attaquant au serveur d'autorisation sur un state invalide.
     */
    public function test_callback_rejects_mismatched_state_and_clears_pkce(): void {
        // Cree un vrai PKCE en attente (state genere cote serveur).
        Chapote_BO_API::build_authorize_url();
        $realState = Chapote_BO_API::pkce_pending()['state'];

        $res = Chapote_BO_REST::connect_callback(
            $this->callbackRequest('attacker-code', $realState . '-tampered')
        );

        $this->assertSame(400, $res->get_status());
        $this->assertSame('state_mismatch', $res->get_data()['error']);
        // Garantie anti-CSRF PROUVEE : zero appel HTTP sortant (pas d'echange de code).
        $this->assertSame(
            0,
            $GLOBALS['_wpt']['remote_calls'],
            'State invalide => aucun echange de code ne doit avoir lieu.'
        );
        // PKCE purge : un second essai (meme rejoue avec le bon state) est mort.
        $this->assertNull(
            Chapote_BO_API::pkce_pending(),
            'Le PKCE en attente doit etre purge apres un state invalide (one-time).'
        );
    }
}
