# shellcheck shell=sh

set -eux

PLAN="$1"

cd "${SOURCE}"

# tests need cockpit's bots/ libraries
git clone --depth=1 https://github.com/cockpit-project/bots

# release tarballs include the necessary npm modules for testing
if [ -d .git ]; then
    ./tools/node-modules checkout
fi

TEST_ALLOW_JOURNAL_MESSAGES=""

# HACK: CI hits this selinux denial. Unrelated to our tests.
TEST_ALLOW_JOURNAL_MESSAGES=".*Permission denied:.*/var/cache/app-info/xmls.*"

export TEST_ALLOW_JOURNAL_MESSAGES

# Chromium sometimes gets OOM killed on testing farm
export TEST_BROWSER=firefox

# make it easy to check in logs
echo "TEST_ALLOW_JOURNAL_MESSAGES: ${TEST_ALLOW_JOURNAL_MESSAGES:-}"
echo "TEST_AUDIT_NO_SELINUX: ${TEST_AUDIT_NO_SELINUX:-}"

EXCLUDES=""

# We only have one VM per plan and tests should take at most one hour. So run those tests which exercise external API
# (and thus are useful for reverse dependency testing and gating), and exclude those which test cockpit-internal
# functionality to upstream CI. We also need to leave out some which make too strict assumptions about the testbed.
if [ "$PLAN" = "main" ]; then
    # Don't run TestPages, TestPackages, and TestTerminal at all -- not testing external APIs
    TESTS="TestAutoUpdates
           TestAccounts
           TestBonding
           TestBridge
           TestFirewall
           TestJournal
           TestKdump
           TestLogin
           TestNetworking
           TestSOS
           TestServices
           TestSystemInfo
           TestTeam
           TestTuned
           TestUpdates
           "

    # PCI devices list is not predictable
    EXCLUDES="$EXCLUDES TestSystemInfo.testHardwareInfo"

    # TODO: investigate failure
    if [ "$TEST_OS" = "centos-10" ]; then
        EXCLUDES="$EXCLUDES TestLogin.testClientCertAuthentication"
    fi

    # TODO: our /usr/local/ bind mount isn't "visible" to systemd
    if [ "${TEST_OS%bootc}" != "$TEST_OS" ]; then
        EXCLUDES="$EXCLUDES TestServices.testTimer"
    fi

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestAccounts.testAccountLogs
              TestAccounts.testExpire
              TestAccounts.testRootLogin
              TestAccounts.testUnprivileged

              TestAutoUpdates.testBasic
              TestAutoUpdates.testPrivilegeChange

              TestBonding.testActive
              TestBonding.testAmbiguousMember
              TestBonding.testNonDefaultSettings

              TestFirewall.testAddCustomServices
              TestFirewall.testNetworkingPage

              TestLogin.testConversation
              TestLogin.testExpired
              TestLogin.testFailingWebsocket
              TestLogin.testFailingWebsocketSafari
              TestLogin.testFailingWebsocketSafariNoCA
              TestLogin.testLogging
              TestLogin.testNFSHomeDir
              TestLogin.testSSH
              TestLogin.testRaw
              TestLogin.testServer
              TestLogin.testSELinuxRestrictedUser
              TestLogin.testUnsupportedBrowser

              TestNetworkingBasic.testIpHelper
              TestNetworkingBasic.testNoService
              TestNetworkingCheckpoints.testCheckpoint
              TestNetworkingCheckpoints.testCheckpointSlowRollback
              TestNetworkingUnmanaged.testUnmanaged

              TestSOS.testWithUrlRoot
              TestSOS.testCancel
              TestSOS.testAppStream

              TestSystemInfo.testInsightsStatus
              TestSystemInfo.testMotd
              TestSystemInfo.testOverview
              TestSystemInfo.testShutdownStatus

              TestJournal.testAbrtDelete
              TestJournal.testAbrtReportNoReportd
              TestJournal.testAbrtReportCancel
              TestJournal.testBinary
              TestJournal.testNoMessage

              TestServices.testApi
              TestServices.testConditions
              TestServices.testHiddenFailure
              TestServices.testLogs
              TestServices.testLogsUser
              TestServices.testNotFound
              TestServices.testNotifyFailed
              TestServices.testRelationships
              TestServices.testRelationshipsUser
              TestServices.testResetFailed
              TestServices.testTransientUnits
              TestServices.testUnprivileged
              TestServices.testQuadlets

              TestUpdates.testUnprivileged
              TestUpdates.testPackageKitCrash
              TestUpdates.testNoPackageKit
              TestUpdates.testInfoTruncation
              "

    # Testing Farm machines often have pending restarts/reboot
    EXCLUDES="$EXCLUDES
              TestUpdates.testBasic
              TestUpdates.testDnfRestart
              TestUpdates.testFailServiceRestart
              TestUpdates.testKpatch
              "
fi

if [ "$PLAN" = "storage-basic" ]; then
    TESTS="TestStorageBasic
           TestStorageBtrfs
           TestStorageMdRaid
           TestStorageMounting
           TestStorageMountingLUKS
           TestStorageMsDOS
           TestStorageNfs
           TestStoragePartitions
           TestStorageRaid
           TestStorageStratis
           TestStorageUnrecognized
           TestStorageUsed
           TestStorageswap
           "

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestStorageAnaconda.testBasic

              TestStorageBtrfs.testNothingMounted

              TestStorageMounting.testAtBoot
              TestStorageMounting.testBadOption
              TestStorageMounting.testFirstMount
              TestStorageMounting.testMounting
              TestStorageMounting.testMountingHelp
              TestStorageMounting.testNeverAuto
              TestStorageMountingLUKS.testEncryptedMountingHelp
              TestStorageMountingLUKS.testDuplicateMountPoints
              TestStorageMountingLUKS.testNeverAuto

              TestStoragePartitions.testSizeSlider
              TestStorageStratis.testAlerts
              "

    # RHEL test machines have a lot of junk mounted on /mnt
    if [ "${TEST_OS#rhel-}" != "$TEST_OS" ]; then
        EXCLUDES="$EXCLUDES
            TestStorageNfs.testNfsBusy
            TestStorageNfs.testNfsClient
            TestStorageNfs.testNfsMountWithoutDiscovery
            "
    fi

    if [ "${TEST_OS%bootc}" != "$TEST_OS" ]; then
        # no swap on TF bootc
        EXCLUDES="$EXCLUDES
                  TestStorageswap.testBasic
                  TestStorageswap.testEncrypted
                  "
    fi
fi

if [ "$PLAN" = "storage-extra" ]; then
    TESTS="TestStorageAnaconda
           TestStorageLuks
           TestStorageMountingLUKS
           TestStorageLvm
           "

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestStorageAnaconda.testBasic

              TestStorageMountingLUKS.testEncryptedMountingHelp
              TestStorageMountingLUKS.testDuplicateMountPoints
              TestStorageMountingLUKS.testNeverAuto
              "
fi

exclude_options=""
for t in $EXCLUDES; do
    exclude_options="$exclude_options --exclude $t"
done

GATEWAY="$(python3 -c 'import socket; print(socket.gethostbyname("_gateway"))')"
RC=0
./test/common/run-tests \
    --test-dir test/verify \
    --nondestructive \
    --machine "${GATEWAY}":22 \
    --browser "${GATEWAY}":9090 \
    $exclude_options \
    $TESTS \
|| RC=$?

echo $RC > "$LOGS/exitcode"
cp --verbose Test* "$LOGS" || true
exit $RC
