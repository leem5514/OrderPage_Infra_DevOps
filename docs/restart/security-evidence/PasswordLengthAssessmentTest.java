package com.example.ordersystem.securityassessment;
import com.example.ordersystem.common.configs.WebConfig;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.junit.jupiter.api.Assertions.assertTrue;
class PasswordLengthAssessmentTest {
    @Test
    void differentSuffixAfterSeventyTwoAsciiBytesStillMatches() {
        PasswordEncoder encoder=new WebConfig().makePassword();
        String prefix="a".repeat(72);
        String encoded=encoder.encode(prefix+"-first");
        assertTrue(encoder.matches(prefix+"-different",encoded));
    }
}
