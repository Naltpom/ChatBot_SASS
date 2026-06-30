<?php
/**
 * Frontiere de securite : garde de permission du proxy REST
 * (Chapote_BO_REST::can()). Toute route du namespace chapote-bo/v1 exige
 * `manage_options` ET un nonce `wp_rest` valide. On verifie les quatre cadrans
 * (cap x nonce) + que la garde lit bien l'en-tete X-WP-Nonce et reclame l'action
 * 'wp_rest'. Un seul des deux facteurs manquant => REFUS.
 */

use PHPUnit\Framework\TestCase;

final class RestPermissionTest extends TestCase {

    protected function setUp(): void {
        wpt_reset();
    }

    private function request(?string $nonce = 'valid-nonce'): Fake_REST_Request {
        $r = new Fake_REST_Request();
        if ($nonce !== null) {
            $r->set_header('X-WP-Nonce', $nonce);
        }
        return $r;
    }

    public function test_accepts_when_capability_and_nonce_valid(): void {
        $GLOBALS['_wpt']['user_can'] = true;
        $GLOBALS['_wpt']['nonce_ok'] = true;
        $this->assertTrue(Chapote_BO_REST::can($this->request()));
    }

    public function test_rejects_without_capability_even_with_valid_nonce(): void {
        $GLOBALS['_wpt']['user_can'] = false;
        $GLOBALS['_wpt']['nonce_ok'] = true;
        $this->assertFalse(
            Chapote_BO_REST::can($this->request()),
            'manage_options absent => refus, meme avec un nonce valide.'
        );
    }

    public function test_rejects_with_invalid_nonce_even_with_capability(): void {
        $GLOBALS['_wpt']['user_can'] = true;
        $GLOBALS['_wpt']['nonce_ok'] = false;
        $this->assertFalse(
            Chapote_BO_REST::can($this->request()),
            'Nonce invalide => refus, meme avec la capability.'
        );
    }

    public function test_rejects_when_nonce_header_missing(): void {
        $GLOBALS['_wpt']['user_can'] = true;
        $GLOBALS['_wpt']['nonce_ok'] = true; // sans importance : pas d'en-tete
        $this->assertFalse(
            Chapote_BO_REST::can($this->request(null)),
            'En-tete X-WP-Nonce absent => refus.'
        );
    }

    public function test_rejects_when_both_missing(): void {
        $GLOBALS['_wpt']['user_can'] = false;
        $GLOBALS['_wpt']['nonce_ok'] = false;
        $this->assertFalse(Chapote_BO_REST::can($this->request(null)));
    }

    /**
     * La garde DOIT court-circuiter sur la capability : si l'utilisateur n'a pas
     * manage_options, on ne valide meme pas le nonce. Evite toute fuite de signal
     * et garantit l'ordre cap-puis-nonce.
     */
    public function test_capability_is_checked_before_nonce(): void {
        $GLOBALS['_wpt']['user_can'] = false;
        $GLOBALS['_wpt']['nonce_ok'] = true;
        Chapote_BO_REST::can($this->request());
        $this->assertCount(
            0,
            $GLOBALS['_wpt']['nonce_calls'],
            'wp_verify_nonce ne doit pas etre appele si la capability manque.'
        );
    }

    /** Quand la capability est presente, la garde verifie le nonce pour l'action 'wp_rest'. */
    public function test_nonce_is_verified_against_wp_rest_action(): void {
        $GLOBALS['_wpt']['user_can'] = true;
        $GLOBALS['_wpt']['nonce_ok'] = true;
        Chapote_BO_REST::can($this->request('le-nonce'));

        $this->assertCount(1, $GLOBALS['_wpt']['nonce_calls']);
        [$nonce, $action] = $GLOBALS['_wpt']['nonce_calls'][0];
        $this->assertSame('le-nonce', $nonce, 'Le nonce verifie doit provenir de X-WP-Nonce.');
        $this->assertSame('wp_rest', $action, "L'action du nonce doit etre 'wp_rest'.");
    }

    /**
     * La garde DOIT exiger EXACTEMENT la capability 'manage_options'. On capture la
     * capability interrogee : un downgrade de can() vers une capability plus faible
     * (ex. 'read') ferait echouer cet assert au lieu de passer en silence.
     */
    public function test_requires_exactly_manage_options_capability(): void {
        $GLOBALS['_wpt']['user_can'] = true;
        $GLOBALS['_wpt']['nonce_ok'] = true;
        Chapote_BO_REST::can($this->request());
        $this->assertSame('manage_options', $GLOBALS['_wpt']['cap_calls'][0]);
    }

    /**
     * Anti-downgrade : un utilisateur qui possede 'read' mais PAS 'manage_options'
     * doit etre REFUSE. Si can() interrogeait une capability plus faible que
     * 'manage_options', ce test passerait au vert a tort => il garde la frontiere.
     */
    public function test_weaker_capability_does_not_grant_access(): void {
        $GLOBALS['_wpt']['caps']     = array('manage_options' => false, 'read' => true);
        $GLOBALS['_wpt']['nonce_ok'] = true;
        $this->assertFalse(
            Chapote_BO_REST::can($this->request()),
            "Avoir 'read' sans 'manage_options' ne doit pas ouvrir le proxy."
        );
        $this->assertSame(
            'manage_options',
            $GLOBALS['_wpt']['cap_calls'][0],
            "La garde doit interroger 'manage_options', pas une capability plus faible."
        );
    }
}
